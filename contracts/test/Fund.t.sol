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
        fund.registerJudge(judgeA, 851590);
        fund.commitCapital(judgeA, 600 * U);
        vm.stopPrank();

        // The judge draws its own capital. Nobody hands it anything.
        vm.prank(judgeA);
        fund.callCapital(600 * U);

        // A judge spends its own balance, so it approves the fund to move its USDC.
        vm.prank(judgeA);
        usdc.approve(address(fund), type(uint256).max);
    }

    function test_capitalCall_drawsAgainstCommitment() public {
        assertEq(usdc.balanceOf(judgeA), 600 * U, "judge drew its own capital");
        assertEq(fund.cash(), 400 * U, "fund cash reduced by the call");
        assertEq(fund.totalCalled(), 600 * U, "call tracked");
        assertEq(fund.undrawn(judgeA), 0, "commitment fully drawn");
        // A capital call moves USDC without changing what the fund is worth.
        assertEq(fund.nav(), 1000 * U, "nav unchanged by the call");
        assertEq(fund.judgeBudget(judgeA), 600 * U, "budget is the wallet balance");
    }

    function test_commit_movesNothingUntilCalled() public {
        vm.prank(operator);
        fund.commitCapital(judgeA, 100 * U);
        assertEq(fund.undrawn(judgeA), 100 * U, "commitment available");
        assertEq(usdc.balanceOf(judgeA), 600 * U, "committing alone moves no USDC");

        vm.prank(judgeA);
        fund.callCapital(40 * U);
        assertEq(usdc.balanceOf(judgeA), 640 * U, "judge drew part of it");
        assertEq(fund.undrawn(judgeA), 60 * U, "rest stays undrawn");
    }

    function test_revert_callBeyondCommitment() public {
        vm.prank(judgeA);
        vm.expectRevert(bytes("exceeds commitment"));
        fund.callCapital(U);
    }

    function test_revert_callCapital_notAJudge() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not a judge"));
        fund.callCapital(U);
    }

    function test_registerJudge_doesNotWipeRecord() public {
        vm.prank(judgeA);
        fund.invest(startup, 200 * U, 1000, "x");

        vm.prank(operator);
        fund.registerJudge(judgeA, 999);

        Fund.Judge memory j = fund.getJudge(judgeA);
        assertEq(j.agentId, 999, "identity updated");
        assertEq(j.deployed, 200 * U, "deployed survives re-registration");
        assertEq(j.committed, 600 * U, "commitment survives re-registration");
        assertEq(j.called, 600 * U, "drawdown survives re-registration");
    }

    function test_invest_movesCapitalAndTracksJudge() public {
        vm.prank(judgeA);
        uint256 dealId = fund.invest(startup, 200 * U, 1000, "ipfs://pitch"); // 10% share

        assertEq(usdc.balanceOf(startup), 200 * U, "startup funded");
        // The capital came out of the judge's wallet, not the fund's.
        assertEq(usdc.balanceOf(judgeA), 400 * U, "judge spent its own balance");
        assertEq(fund.cash(), 400 * U, "fund cash untouched by the investment");
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
        assertEq(fund.cash(), 400 * U + cut, "cut returned to fund");
        assertEq(fund.totalReturned(), cut, "totalReturned");

        Fund.Judge memory j = fund.getJudge(judgeA);
        assertEq(j.returned, cut, "judge credited");
        // Winnings raise what the judge may draw next, rather than being paid out.
        assertEq(j.committed, 600 * U + cut, "returns grow the commitment");
        assertEq(fund.undrawn(judgeA), cut, "and become callable");
        assertEq(fund.judgeRoiBps(judgeA), (cut * 10000) / (200 * U), "roi");
        assertEq(fund.nav(), 1000 * U + cut, "nav grew by returns");
    }

    function test_revert_notJudge() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not a judge"));
        fund.invest(startup, U, 1000, "x");
    }

    /// There is no mandate ceiling any more: a judge is stopped by its own balance, which
    /// the token enforces.
    function test_revert_beyondOwnBalance() public {
        vm.prank(judgeA);
        vm.expectRevert();
        fund.invest(startup, 601 * U, 1000, "x");
    }

    function test_revert_commitToUnregisteredJudge() public {
        vm.prank(operator);
        vm.expectRevert(bytes("not a judge"));
        fund.commitCapital(stranger, U);
    }

    function test_revert_commit_onlyOperator() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not operator"));
        fund.commitCapital(judgeA, U);
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
