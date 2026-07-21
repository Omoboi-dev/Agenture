// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fund} from "../src/Fund.sol";
import {RevenueShare} from "../src/RevenueShare.sol";

/// Minimal 6-decimal USDC stand-in for tests.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FundTest is Test {
    MockUSDC usdc;
    Fund fund;
    RevenueShare rs;

    address operator = makeAddr("operator");
    address judgeA = makeAddr("judgeA");
    address startup = makeAddr("startup");
    address stranger = makeAddr("stranger");

    uint256 constant U = 1e6; // 1 USDC (6dp)

    function setUp() public {
        usdc = new MockUSDC();
        fund = new Fund(address(usdc), operator);
        rs = new RevenueShare(address(usdc), address(fund));

        vm.prank(operator);
        fund.setRevenueShare(address(rs));

        // seed 1000 USDC of capital
        usdc.mint(operator, 1000 * U);
        vm.startPrank(operator);
        usdc.approve(address(fund), 1000 * U);
        fund.depositCapital(1000 * U);
        fund.registerJudge(judgeA, 851590, 600 * U);
        vm.stopPrank();
    }

    function test_invest_movesCapitalAndTracksJudge() public {
        vm.prank(judgeA);
        uint256 dealId = fund.invest(startup, 200 * U, 1000, "ipfs://pitch"); // 10% share

        assertEq(usdc.balanceOf(startup), 200 * U, "startup funded");
        assertEq(fund.cash(), 800 * U, "fund cash reduced");
        assertEq(fund.totalOutstanding(), 200 * U, "outstanding tracked");
        assertEq(fund.nav(), 1000 * U, "nav unchanged right after invest");

        Fund.Judge memory j = fund.getJudge(judgeA);
        assertEq(j.deployed, 200 * U, "judge deployed");

        Fund.Deal memory d = fund.getDeal(dealId);
        assertEq(d.startup, startup);
        assertEq(d.revenueShareBps, 1000);
    }

    function test_settle_routesCutBackToFund() public {
        vm.prank(judgeA);
        uint256 dealId = fund.invest(startup, 200 * U, 1000, "ipfs://pitch");

        // startup earns 50 USDC (simulating x402 revenue) and settles
        usdc.mint(startup, 50 * U);
        vm.prank(startup);
        usdc.approve(address(rs), type(uint256).max);
        vm.prank(startup);
        rs.settle(dealId, 50 * U);

        uint256 cut = (50 * U * 1000) / 10000; // 5 USDC
        assertEq(fund.cash(), 800 * U + cut, "cut returned to fund");
        assertEq(fund.totalReturned(), cut, "totalReturned");

        Fund.Judge memory j = fund.getJudge(judgeA);
        assertEq(j.returned, cut, "judge credited");
        assertEq(fund.judgeRoiBps(judgeA), (cut * 10000) / (200 * U), "roi");
        assertEq(fund.nav(), 1000 * U + cut, "nav grew by returns");
    }

    function test_revert_notJudge() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not a judge"));
        fund.invest(startup, U, 1000, "x");
    }

    function test_revert_overMandate() public {
        vm.prank(judgeA);
        vm.expectRevert(bytes("over mandate"));
        fund.invest(startup, 601 * U, 1000, "x");
    }

    function test_revert_recordReturn_onlyRevenueShare() public {
        vm.prank(judgeA);
        uint256 dealId = fund.invest(startup, 200 * U, 1000, "x");
        vm.prank(stranger);
        vm.expectRevert(bytes("only revenueShare"));
        fund.recordReturn(dealId, U);
    }

    function test_revert_settle_onlyStartup() public {
        vm.prank(judgeA);
        uint256 dealId = fund.invest(startup, 200 * U, 1000, "x");
        vm.prank(stranger);
        vm.expectRevert(bytes("only startup"));
        rs.settle(dealId, U);
    }
}
