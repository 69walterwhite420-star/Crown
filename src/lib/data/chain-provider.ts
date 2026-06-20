import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { DEVNET_RPC, DEVNET_USDC_MINT, TREASURY_OWNER } from "../chain/config";
import { buildDonationInstructions, splitAmount } from "../chain/donation-tx";
import { toMicro } from "../utils";
import { ApiDataProvider } from "./api-provider";
import { DataError, type DataProvider, type Result } from "./provider";
import type {
  Address,
  Channel,
  ChannelBlock,
  ChannelCard,
  ChannelConfig,
  ConfigPatch,
  CreateChannelInput,
  Donation,
  DonationInput,
  DonationResult,
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LightProfile,
  ListOpts,
  MessageRef,
  OperatorAction,
  OverlayEvent,
  Page,
  Session,
  ViewerStanding,
} from "./types";

/**
 * Фаза 3 (crypto/spec.md §7): ГИБРИД. Чтение репутации/каналов/модерации — из оффчейн-бэкенда
 * (индексер кормит его), поэтому делегируется `ApiDataProvider`. Запись денег — через кошелёк:
 * `connect` (SIWS, gasless), `createDonation` (сборка tx 97/3 + memo + ATA, подпись кошельком).
 * Финальный зачёт репутации делает индексер; здесь возвращается оптимистичный результат.
 *
 * Кошелёк инжектится из React-дерева (useWallet) через setWallet — класс не вызывает хуки.
 */
export class ChainDataProvider implements DataProvider {
  private api = new ApiDataProvider();
  private connection = new Connection(DEVNET_RPC, "confirmed");
  private wallet: WalletContextState | null = null;

  setWallet(wallet: WalletContextState | null) {
    this.wallet = wallet;
    // Адрес кошелька — личность бэкенд-запросов (создание канала, чтение standing и т.д.).
    this.api.__setAddress(wallet?.publicKey?.toBase58() ?? null);
  }
  private address(): string | null {
    return this.wallet?.publicKey?.toBase58() ?? null;
  }

  // — Кошелёк (ончейн) —
  async getSession(): Result<Session> {
    // Бэкенд считает isCreator/isOperator по адресу (его установил setWallet).
    return this.api.getSession();
  }
  async connect(): Result<Session> {
    const w = this.wallet;
    if (!w) throw new DataError("NO_WALLET", "Кошелёк не подключён.");
    if (!w.connected) await w.connect();
    this.api.__setAddress(w.publicKey?.toBase58() ?? null);
    // Sign-In-With-Solana: подпись сообщения без газа.
    if (w.signMessage && w.publicKey) {
      const msg = new TextEncoder().encode(
        `Standing — вход\naddress: ${w.publicKey.toBase58()}\nnonce: ${w.publicKey.toBase58().slice(0, 8)}`,
      );
      await w.signMessage(msg);
    }
    return this.api.getSession();
  }
  async disconnect(): Result<void> {
    this.api.__setAddress(null);
    await this.wallet?.disconnect?.();
  }

  async createDonation(input: DonationInput): Result<DonationResult> {
    const w = this.wallet;
    if (!w?.publicKey || !w.sendTransaction) throw new DataError("NO_WALLET", "Подключи кошелёк.");
    if (!DEVNET_USDC_MINT || !TREASURY_OWNER) {
      throw new DataError(
        "NOT_CONFIGURED",
        "Не заданы NEXT_PUBLIC_DEVNET_USDC_MINT и NEXT_PUBLIC_TREASURY_OWNER.",
      );
    }
    // Разрешаем channelId → payoutAddress через оффчейн-бэкенд.
    const list = await this.api.listChannels();
    const card = list.items.find((c) => c.channelId === input.channelId);
    const channel = card ? await this.api.getChannel(card.handle) : null;
    if (!channel) throw new DataError("NO_CHANNEL", "Канал не найден или не активирован.");

    const amountMicro = toMicro(input.amountUSDC);
    const { fee, net } = splitAmount(amountMicro);
    const donationId = `d-${this.address()}-${list.items.length}`;
    const ix = await buildDonationInstructions(this.connection, {
      donor: w.publicKey,
      payout: new PublicKey(channel.payoutAddress),
      treasury: new PublicKey(TREASURY_OWNER),
      mint: new PublicKey(DEVNET_USDC_MINT),
      amountMicro,
      creatorId: input.channelId,
      donationId,
      msgRef: input.text ? `${donationId}-m` : null,
    });
    const tx = new Transaction().add(...ix);
    tx.feePayer = w.publicKey;
    const latest = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const signature = await w.sendTransaction(tx, this.connection);

    // Дожидаемся подтверждения и просим сервер ПРИНЯТЬ донат из цепочки (он сам валидирует tx).
    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    try {
      await this.api.ingestSignature(signature);
    } catch {
      // не страшно: индексер-сервис подхватит инфлоу позже
    }

    const donation: Donation = {
      id: donationId,
      channelId: input.channelId,
      donor: w.publicKey.toBase58(),
      amount: amountMicro,
      feeAmount: fee,
      netToStreamer: net,
      txSignature: signature,
      final: true,
      ts: new Date().toISOString(),
    };
    const donorAddr = w.publicKey.toBase58();
    let standing = await this.api.getStanding(input.channelId, donorAddr);
    if (!standing) {
      const cfg = await this.api.getChannelConfig(input.channelId);
      standing = {
        channelId: input.channelId,
        donor: donorAddr,
        points: 0,
        tier: cfg.tiers[0]!,
        progressToNext: 0,
        totalDonated: 0n,
      };
    }
    return { donation, standing, tierChanged: false };
  }

  // — Оффчейн-слой (читается из бэкенда, кормится индексером) → делегируем ApiDataProvider —
  getProfile(a: Address): Result<LightProfile | null> {
    return this.api.getProfile(a);
  }
  updateProfile(p: Partial<LightProfile>): Result<LightProfile> {
    return this.api.updateProfile(p);
  }
  listChannels(o?: ListOpts): Result<Page<ChannelCard>> {
    return this.api.listChannels(o);
  }
  getChannel(h: string): Result<Channel | null> {
    return this.api.getChannel(h);
  }
  getMyChannel(): Result<Channel | null> {
    return this.api.getMyChannel();
  }
  getChannelConfig(id: string): Result<ChannelConfig> {
    return this.api.getChannelConfig(id);
  }
  createChannel(i: CreateChannelInput): Result<Channel> {
    return this.api.createChannel(i);
  }
  activateChannel(id: string): Result<Channel> {
    return this.api.activateChannel(id); // полноценно — ончейн-сбор; пока оффчейн-флип
  }
  updateChannelConfig(id: string, p: ConfigPatch): Result<ChannelConfig> {
    return this.api.updateChannelConfig(id, p);
  }
  getStanding(id: string, d: Address): Result<ViewerStanding | null> {
    return this.api.getStanding(id, d);
  }
  getLeaderboard(id: string, p: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    return this.api.getLeaderboard(id, p);
  }
  listDonations(id: string, o?: ListOpts): Result<Page<Donation>> {
    return this.api.listDonations(id, o);
  }
  getModerationQueue(id: string): Result<MessageRef[]> {
    return this.api.getModerationQueue(id);
  }
  setMessageState(id: string, s: "SHOWN" | "HIDDEN"): Result<MessageRef> {
    return this.api.setMessageState(id, s);
  }
  getChannelBlocklist(id: string): Result<ChannelBlock[]> {
    return this.api.getChannelBlocklist(id);
  }
  addChannelBlock(id: string, a: Address, r?: string): Result<ChannelBlock> {
    return this.api.addChannelBlock(id, a, r);
  }
  removeChannelBlock(id: string, a: Address): Result<void> {
    return this.api.removeChannelBlock(id, a);
  }
  getOperatorQueue(): Result<IncidentLog[]> {
    return this.api.getOperatorQueue();
  }
  applyOperatorAction(a: Omit<OperatorAction, "id" | "ts" | "byOperator">): Result<OperatorAction> {
    return this.api.applyOperatorAction(a);
  }
  getIncidentLog(o?: ListOpts): Result<Page<IncidentLog>> {
    return this.api.getIncidentLog(o);
  }
  subscribeOverlay(id: string, cb: (e: OverlayEvent) => void): () => void {
    return this.api.subscribeOverlay(id, cb);
  }
}
