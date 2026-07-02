import { describe, expect, it } from "vitest";
import { MockDataProvider } from "./mock-provider";

/**
 * Анти-wash (self-dealing): донат/задание самому себе не должно копить репутацию. Владелец с payout=свой
 * кошелёк иначе крутил бы bankroll — 97% возвращается ему, а очки капают за ~3% комиссии (§4.3/§4.4).
 * Деньги ончейн финальны (не отклоняем реальный платёж), поэтому на ингест-пути очки = 0; офчейн-донат
 * отклоняем сразу. Курс floor: 5 USDC → 5 очков.
 */

const OWNER = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PAYOUT = "9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe";
const OTHER = "GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4";

function provider() {
  const p = new MockDataProvider();
  p.__setLatencyScale(0);
  return p;
}

async function ownedChannel() {
  const p = provider();
  p.__setAddress(OWNER);
  const ch = await p.createChannel({ handle: "mine", payoutAddress: PAYOUT });
  return { p, channelId: ch.id };
}

describe("анти-wash: self-донат не копит репутацию", () => {
  it("офчейн createDonation самому себе (owner или payout) → SELF_DONATION", async () => {
    const { p, channelId } = await ownedChannel();
    await expect(p.createDonation({ channelId, amountUSDC: 5 })).rejects.toMatchObject({
      code: "SELF_DONATION",
    });
    p.__setAddress(PAYOUT);
    await expect(p.createDonation({ channelId, amountUSDC: 5 })).rejects.toMatchObject({
      code: "SELF_DONATION",
    });
  });

  it("ончейн-ингест self-доната: платёж записан, но 0 очков; сторонний донор — очки капают", async () => {
    const { p, channelId } = await ownedChannel();
    const args = { channelId, amountMicro: 5_000_000n, feeMicro: 150_000n, netMicro: 4_850_000n };
    const self = await p.recordDonationFromChain({ signature: "sig-self", donor: OWNER, ...args });
    expect(self?.standing.points).toBe(0); // self-deal → без репутации

    const other = await p.recordDonationFromChain({ signature: "sig-other", donor: OTHER, ...args });
    expect(other?.standing.points).toBe(5); // 5 USDC → 5 очков (floor, 1:1)
  });
});
