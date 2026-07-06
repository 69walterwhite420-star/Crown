import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Instruction builders for the Crown-task escrow program (G3a, ADR 0017; the program is in `anchor/`). By hand, without
 * an anchor IDL/client (stack on web3.js v1, like `donation-tx.ts`): an Anchor instruction = an 8-byte discriminator
 * `sha256("global:<name>")[..8]` + Borsh args; accounts — in the order of `#[derive(Accounts)]` with the
 * signer/writable flags from the program. Only the program moves money, by deterministic right; the recipients and
 * amount are baked into the PDA at `fund` — no one can steal or redirect it (non-custodial §4.1).
 */

// Discriminators (sha256("global:<fn>")[..8]) — computed from the program's function names.
const DISC = {
  fund: [218, 188, 111, 221, 152, 113, 174, 7],
  accept: [65, 150, 70, 216, 133, 6, 107, 4], // ESC-19: on-chain accept is required before mark_done
  reject: [135, 7, 63, 85, 131, 114, 111, 224],
  markDone: [112, 146, 215, 90, 40, 16, 44, 149], // mark_done
  cancel: [232, 219, 223, 41, 219, 236, 220, 190],
  resolveTimeout: [149, 55, 89, 144, 121, 143, 48, 210], // resolve_timeout
  // mark_disputed / resolve_dispute are NOT sent by the front since M2 (the canister arbiter sends them via
  // threshold signature; the manual-resolver builders were removed). The discriminators are kept as a readable
  // source to reconcile with the canister: canister/core/src/arbiter.rs::DISC_* must match byte-for-byte.
  markDisputed: [136, 86, 152, 120, 3, 21, 223, 251], // mark_disputed
  resolveDispute: [231, 6, 202, 6, 96, 103, 12, 230], // resolve_dispute
  claimStreamer: [126, 138, 229, 228, 43, 41, 147, 179], // claim_streamer
  claimDonor: [50, 4, 6, 190, 27, 110, 39, 211], // claim_donor
} as const;

const ESCROW_SEED = Buffer.from("escrow");

/** 32-byte on-chain task identifier = the escrow PDA seed. The client generates a random one at creation. */
export type TaskId = Uint8Array; // exactly 32 bytes

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}
function disc(d: readonly number[]): Buffer {
  return Buffer.from(d);
}

/** Escrow PDA for a task: seeds = ["escrow", task_id]. */
export function escrowPda(programId: PublicKey, taskId: TaskId): PublicKey {
  return PublicKey.findProgramAddressSync([ESCROW_SEED, Buffer.from(taskId)], programId)[0];
}
/** The escrow's USDC vault — an ATA, owner = escrow PDA (off-curve). */
export function vaultAta(mint: PublicKey, escrow: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, escrow, true);
}

async function accountExists(connection: Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}

export interface FundParams {
  programId: PublicKey;
  donor: PublicKey;
  streamer: PublicKey; // the streamer's payout owner (donor's counterparty). Treasury/resolver — program constants.
  mint: PublicKey;
  taskId: TaskId;
  amount: bigint; // micro-USDC
  executionWindow: bigint; // seconds (corridor [60 .. 90d] — checked by the program)
}

/** `fund`: create the escrow PDA + vault and transfer amount USDC donor→vault (the donor signs). */
export async function buildFundIx(p: FundParams): Promise<TransactionInstruction> {
  const escrow = escrowPda(p.programId, p.taskId);
  const vault = await vaultAta(p.mint, escrow);
  const donorAta = await getAssociatedTokenAddress(p.mint, p.donor);
  const data = Buffer.concat([
    disc(DISC.fund),
    Buffer.from(p.taskId),
    u64le(p.amount),
    i64le(p.executionWindow),
  ]);
  return new TransactionInstruction({
    programId: p.programId,
    data,
    keys: [
      { pubkey: p.donor, isSigner: true, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: donorAta, isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: p.streamer, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Streamer action (reject/mark_done): signed by the owner of the payout address. */
function streamerAction(
  programId: PublicKey,
  streamer: PublicKey,
  escrow: PublicKey,
  d: readonly number[],
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    data: disc(d),
    keys: [
      { pubkey: streamer, isSigner: true, isWritable: false },
      { pubkey: escrow, isSigner: false, isWritable: true },
    ],
  });
}
/** `accept` (ESC-19): the streamer accepts the task (Pending→Accepted) — required before mark_done. */
export function buildAcceptIx(programId: PublicKey, streamer: PublicKey, taskId: TaskId) {
  return streamerAction(programId, streamer, escrowPda(programId, taskId), DISC.accept);
}
export function buildRejectIx(programId: PublicKey, streamer: PublicKey, taskId: TaskId) {
  return streamerAction(programId, streamer, escrowPda(programId, taskId), DISC.reject);
}
export function buildMarkDoneIx(programId: PublicKey, streamer: PublicKey, taskId: TaskId) {
  return streamerAction(programId, streamer, escrowPda(programId, taskId), DISC.markDone);
}

/** `cancel`: the donor cancels within the grace window (from both Pending AND Accepted, ESC-13) → refund. */
export function buildCancelIx(programId: PublicKey, donor: PublicKey, taskId: TaskId) {
  return new TransactionInstruction({
    programId,
    data: disc(DISC.cancel),
    keys: [
      { pubkey: donor, isSigner: true, isWritable: false },
      { pubkey: escrowPda(programId, taskId), isSigner: false, isWritable: true },
    ],
  });
}

/** `resolve_timeout`: permissionless — decided by the blockchain clock (any signer pays for the tx). */
export function buildResolveTimeoutIx(programId: PublicKey, caller: PublicKey, taskId: TaskId) {
  return new TransactionInstruction({
    programId,
    data: disc(DISC.resolveTimeout),
    keys: [
      { pubkey: caller, isSigner: true, isWritable: false },
      { pubkey: escrowPda(programId, taskId), isSigner: false, isWritable: true },
    ],
  });
}

/**
 * `mark_disputed`: flag the escrow as disputed → resolve_timeout is blocked until resolution. Since M2 the front
 * does NOT send it (the canister arbiter sends it via threshold signature); the builder lives for the negative
 * escrow-smoke check "a foreign key cannot mark_disputed" (audit #1). There is no resolve_dispute builder at all —
 * its signature exists only as canister consensus.
 */
export function buildMarkDisputedIx(programId: PublicKey, resolver: PublicKey, taskId: TaskId) {
  return new TransactionInstruction({
    programId,
    data: disc(DISC.markDisputed),
    keys: [
      { pubkey: resolver, isSigner: true, isWritable: false },
      { pubkey: escrowPda(programId, taskId), isSigner: false, isWritable: true },
    ],
  });
}

export interface ClaimStreamerParams {
  programId: PublicKey;
  streamer: PublicKey;
  donor: PublicKey; // rent recipient at close
  treasury: PublicKey;
  mint: PublicKey;
  taskId: TaskId;
}

/**
 * `claim_streamer`: the streamer takes the winnings (97% to them, 3% to the treasury), the escrow closes. We prefix
 * it with creating the streamer's/treasury's ATA if they don't exist yet (otherwise the transfer fails) — paid by the streamer.
 */
export async function buildClaimStreamerIxs(
  connection: Connection,
  p: ClaimStreamerParams,
): Promise<TransactionInstruction[]> {
  const escrow = escrowPda(p.programId, p.taskId);
  const vault = await vaultAta(p.mint, escrow);
  const streamerAta = await getAssociatedTokenAddress(p.mint, p.streamer);
  const treasuryAta = await getAssociatedTokenAddress(p.mint, p.treasury);
  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, streamerAta)))
    ix.push(createAssociatedTokenAccountInstruction(p.streamer, streamerAta, p.streamer, p.mint));
  if (!(await accountExists(connection, treasuryAta)))
    ix.push(createAssociatedTokenAccountInstruction(p.streamer, treasuryAta, p.treasury, p.mint));
  ix.push(
    new TransactionInstruction({
      programId: p.programId,
      data: disc(DISC.claimStreamer),
      keys: [
        { pubkey: p.streamer, isSigner: true, isWritable: false },
        { pubkey: p.donor, isSigner: false, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: streamerAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    }),
  );
  return ix;
}

export interface ClaimDonorParams {
  programId: PublicKey;
  donor: PublicKey;
  mint: PublicKey;
  taskId: TaskId;
}

/** `claim_donor`: the donor takes the refund (100%), the escrow closes. donorAta already exists (the donor deposited USDC). */
export async function buildClaimDonorIxs(
  connection: Connection,
  p: ClaimDonorParams,
): Promise<TransactionInstruction[]> {
  const escrow = escrowPda(p.programId, p.taskId);
  const vault = await vaultAta(p.mint, escrow);
  const donorAta = await getAssociatedTokenAddress(p.mint, p.donor);
  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, donorAta)))
    ix.push(createAssociatedTokenAccountInstruction(p.donor, donorAta, p.donor, p.mint));
  ix.push(
    new TransactionInstruction({
      programId: p.programId,
      data: disc(DISC.claimDonor),
      keys: [
        { pubkey: p.donor, isSigner: true, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: donorAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    }),
  );
  return ix;
}

/** Light instruction form from `getParsedTransaction` (PartiallyDecodedInstruction) — for the M3 decoder. */
interface DecodedIx {
  programId: PublicKey;
  accounts?: PublicKey[];
  data?: string; // base58 (as getParsedTransaction returns for unknown programs)
}

/**
 * M3 (event indexer): from the instructions of a SIGNED tx we extract the on-chain outcome of our program's `claim`s —
 * the moment the money ACTUALLY moved. `claim_streamer` → to_streamer (escrow = accounts[2]); `claim_donor` →
 * to_donor (escrow = accounts[1]). Decoding from the INSTRUCTION, not the account → the truth survives the escrow's
 * close (claim closes the account in the same tx). A pure function (no IO) — testable. Returns [{escrow(base58), outcome}].
 */
export function decodeEscrowClaims(
  programId: PublicKey,
  instructions: DecodedIx[],
): { escrow: string; outcome: "to_streamer" | "to_donor" }[] {
  const out: { escrow: string; outcome: "to_streamer" | "to_donor" }[] = [];
  for (const ix of instructions) {
    if (!ix.programId.equals(programId) || !ix.data || !ix.accounts) continue;
    let disc: Uint8Array;
    try {
      disc = bs58.decode(ix.data).subarray(0, 8);
    } catch {
      continue; // not base58 / empty data
    }
    const eq = (d: readonly number[]) => disc.length === 8 && d.every((b, i) => b === disc[i]);
    if (eq(DISC.claimStreamer) && ix.accounts[2])
      out.push({ escrow: ix.accounts[2].toBase58(), outcome: "to_streamer" });
    else if (eq(DISC.claimDonor) && ix.accounts[1])
      out.push({ escrow: ix.accounts[1].toBase58(), outcome: "to_donor" });
  }
  return out;
}

/** Decoder of the Escrow account (for the indexer/state reads): layout from the program (Anchor). */
export interface EscrowAccount {
  taskId: Uint8Array;
  donor: PublicKey;
  streamer: PublicKey;
  treasury: PublicKey;
  mint: PublicKey;
  resolver: PublicKey;
  amount: bigint;
  executionWindow: bigint;
  state: number; // 0 Pending,1 Accepted,2 Done,3 Resolved,4 Disputed
  resolution: number; // 0 Unresolved,1 ToStreamer,2 ToDonor
  acceptDeadline: bigint;
  doneDeadline: bigint;
  disputeDeadline: bigint;
  bump: number;
}

/** Parse the raw Escrow account data (8-byte discriminator + fields in struct order). */
export function decodeEscrow(data: Uint8Array): EscrowAccount {
  const b = Buffer.from(data);
  let o = 8; // skip Anchor discriminator
  const take = (n: number) => {
    const s = b.subarray(o, o + n);
    o += n;
    return s;
  };
  const taskId = new Uint8Array(take(32));
  const donor = new PublicKey(take(32));
  const streamer = new PublicKey(take(32));
  const treasury = new PublicKey(take(32));
  const mint = new PublicKey(take(32));
  const resolver = new PublicKey(take(32));
  const amount = b.readBigUInt64LE(o);
  o += 8;
  const executionWindow = b.readBigInt64LE(o);
  o += 8;
  const state = b.readUInt8(o);
  o += 1;
  const resolution = b.readUInt8(o);
  o += 1;
  const acceptDeadline = b.readBigInt64LE(o);
  o += 8;
  const doneDeadline = b.readBigInt64LE(o);
  o += 8;
  const disputeDeadline = b.readBigInt64LE(o);
  o += 8;
  const bump = b.readUInt8(o);
  return {
    taskId,
    donor,
    streamer,
    treasury,
    mint,
    resolver,
    amount,
    executionWindow,
    state,
    resolution,
    acceptDeadline,
    doneDeadline,
    disputeDeadline,
    bump,
  };
}
