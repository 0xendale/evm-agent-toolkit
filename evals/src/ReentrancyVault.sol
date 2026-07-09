// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ReentrancyVault
 * @notice A deliberately vulnerable contract for Agent evaluations.
 * @dev The withdraw function violates the Checks-Effects-Interactions pattern.
 */
contract ReentrancyVault {
    mapping(address => uint256) public balances;

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() public {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "Insufficient balance");

        // VULNERABILITY: External call before state update
        (bool success, ) = msg.sender.call{value: bal}("");
        require(success, "Transfer failed");

        balances[msg.sender] = 0;
    }
}
