/**
 * Интеграционные тесты эскроу-программы (G3a). Скаффолд — гоняется `anchor test` на localnet (нужен
 * тулчейн, см. BUILD.md; в dev-окружении Standing не собиралось — нет хост-gcc).
 *
 * Покрывает пути, не зависящие от длинных таймаутов:
 *   • happy: fund → accept → mark_done → resolve_dispute(toStreamer) → claim_streamer (97/3 split);
 *   • refund: fund → reject → claim_donor (100% назад).
 * Пути по таймауту (resolve_timeout: 72ч/12ч/no-show) требуют варпа часов валидатора — отдельный
 * харнесс (не здесь).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { EscrowTask } from "../target/types/escrow_task";

const FEE_BPS = 300n;
const BPS = 10_000n;

describe("escrow-task (G3a)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EscrowTask as Program<EscrowTask>;
  const conn = provider.connection;

  const donor = Keypair.generate();
  const streamer = Keypair.generate();
  const treasury = Keypair.generate();
  const resolver = Keypair.generate();
  let mint: PublicKey;
  let donorAta: PublicKey, streamerAta: PublicKey, treasuryAta: PublicKey;

  const AMOUNT = 5_000_000n; // 5 USDC (6 знаков)
  const EXEC_WINDOW = new anchor.BN(24 * 60 * 60);

  const escrowPda = (taskId: Buffer) =>
    PublicKey.findProgramAddressSync([Buffer.from("escrow"), taskId], program.programId)[0];
  const vaultAta = async (escrow: PublicKey) =>
    (await import("@solana/spl-token")).getAssociatedTokenAddressSync(mint, escrow, true);

  before(async () => {
    for (const kp of [donor, streamer, resolver]) {
      await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL));
    }
    mint = await createMint(conn, donor, donor.publicKey, null, 6);
    donorAta = (await getOrCreateAssociatedTokenAccount(conn, donor, mint, donor.publicKey)).address;
    streamerAta = (await getOrCreateAssociatedTokenAccount(conn, donor, mint, streamer.publicKey)).address;
    treasuryAta = (await getOrCreateAssociatedTokenAccount(conn, donor, mint, treasury.publicKey)).address;
    await mintTo(conn, donor, mint, donorAta, donor, Number(AMOUNT) * 2);
  });

  it("happy: fund → accept → done → resolve(toStreamer) → claim_streamer (97/3)", async () => {
    const taskId = Buffer.alloc(32);
    taskId.write("task-happy");
    const escrow = escrowPda(taskId);
    const vault = await vaultAta(escrow);

    await program.methods
      .fund([...taskId], new anchor.BN(AMOUNT.toString()), EXEC_WINDOW)
      .accounts({
        donor: donor.publicKey,
        escrow,
        vault,
        donorToken: donorAta,
        mint,
        streamer: streamer.publicKey,
        treasury: treasury.publicKey,
        resolver: resolver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([donor])
      .rpc();

    await program.methods.accept().accounts({ streamer: streamer.publicKey, escrow }).signers([streamer]).rpc();
    await program.methods.markDone().accounts({ streamer: streamer.publicKey, escrow }).signers([streamer]).rpc();
    await program.methods
      .resolveDispute(true)
      .accounts({ resolver: resolver.publicKey, escrow })
      .signers([resolver])
      .rpc();

    const before = (await getAccount(conn, streamerAta)).amount;
    await program.methods
      .claimStreamer()
      .accounts({
        streamer: streamer.publicKey,
        donor: donor.publicKey,
        escrow,
        vault,
        streamerToken: streamerAta,
        treasuryToken: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([streamer])
      .rpc();

    const fee = (AMOUNT * FEE_BPS) / BPS;
    const net = AMOUNT - fee;
    assert.equal((await getAccount(conn, streamerAta)).amount - before, net, "стример получает 97%");
    assert.equal((await getAccount(conn, treasuryAta)).amount, fee, "трежери получает 3%");
    assert.isNull(await conn.getAccountInfo(escrow), "эскроу закрыт");
  });

  it("refund: fund → reject → claim_donor (100%)", async () => {
    const taskId = Buffer.alloc(32);
    taskId.write("task-refund");
    const escrow = escrowPda(taskId);
    const vault = await vaultAta(escrow);

    const before = (await getAccount(conn, donorAta)).amount;
    await program.methods
      .fund([...taskId], new anchor.BN(AMOUNT.toString()), EXEC_WINDOW)
      .accounts({
        donor: donor.publicKey, escrow, vault, donorToken: donorAta, mint,
        streamer: streamer.publicKey, treasury: treasury.publicKey, resolver: resolver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([donor])
      .rpc();
    await program.methods.reject().accounts({ streamer: streamer.publicKey, escrow }).signers([streamer]).rpc();
    await program.methods
      .claimDonor()
      .accounts({ donor: donor.publicKey, escrow, vault, donorToken: donorAta, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([donor])
      .rpc();

    assert.equal((await getAccount(conn, donorAta)).amount, before, "донору вернулось 100%");
  });
});
