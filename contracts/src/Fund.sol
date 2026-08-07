// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IRevenueShare {
    function registerDeal(uint256 dealId, address startup, uint16 revenueShareBps) external;
}

/// The LP vehicle and the book of record. The fund does not push capital at judges and it
/// does not pay for deals. It *commits* capital, and a judge draws that commitment down
/// itself, when it decides it needs to, exactly as a general partner issues a capital call
/// against what its limited partners have committed.
///
/// So the operator funds this contract once and then stops. Nobody hands a judge money:
/// the judge calls `callCapital`, the USDC lands in its own wallet, and `invest` spends
/// from that wallet rather than from here.
///
/// A judge's revenue share increases its commitment, so a judge that backs winners can
/// draw more later. Earnings are not paid out to it; they become capital it may call.
contract Fund {
    struct Judge {
        bool active;
        uint256 agentId; // ERC-8004 identity, for off-chain reputation attribution
        uint256 committed; // capital the fund has promised it, grows with its returns
        uint256 called; // how much of that it has drawn into its own wallet
        uint256 deployed; // cumulative USDC it has invested
        uint256 returned; // revenue-share its deals have paid back to the fund
    }

    enum DealStatus {
        Active,
        Closed
    }

    struct Deal {
        address judge;
        address startup;
        uint256 amount;
        uint16 revenueShareBps;
        uint256 returned;
        DealStatus status;
        string pitchRef;
    }

    IERC20 public immutable usdc;
    address public operator;
    IRevenueShare public revenueShare;

    uint256 public totalCapital; // cumulative deposited by LPs/operator
    uint256 public totalCommitted; // cumulative promised to judges
    uint256 public totalCalled; // cumulative drawn down by judges
    uint256 public totalDeployed; // cumulative invested into deals
    uint256 public totalReturned; // cumulative revenue-share received back
    uint256 public totalOutstanding; // book value of active positions

    address[] public judgeList;
    mapping(address => Judge) public judges;
    Deal[] public deals;

    event CapitalDeposited(address indexed from, uint256 amount);
    event JudgeRegistered(address indexed judge, uint256 agentId);
    event CapitalCommitted(address indexed judge, uint256 amount, uint256 totalCommitment);
    event CapitalCalled(address indexed judge, uint256 amount, uint256 undrawn);
    event Invested(
        uint256 indexed dealId,
        address indexed judge,
        address indexed startup,
        uint256 amount,
        uint16 revenueShareBps
    );
    event ReturnRecorded(uint256 indexed dealId, uint256 amount);
    event DealClosed(uint256 indexed dealId);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor(address _usdc, address _operator) {
        usdc = IERC20(_usdc);
        operator = _operator;
    }

    function setRevenueShare(address rs) external onlyOperator {
        revenueShare = IRevenueShare(rs);
    }

    function depositCapital(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "deposit failed");
        totalCapital += amount;
        emit CapitalDeposited(msg.sender, amount);
    }

    /// Onboard a judge. Idempotent in the way that matters: re-registering an existing
    /// judge updates its identity without touching allocated, deployed or returned, so a
    /// judge's track record can never be wiped by an admin call.
    function registerJudge(address judge, uint256 agentId) external onlyOperator {
        Judge storage j = judges[judge];
        if (!j.active) {
            j.active = true;
            judgeList.push(judge);
        }
        j.agentId = agentId;
        emit JudgeRegistered(judge, agentId);
    }

    /// Commit capital to a judge. Nothing moves here: this is the promise a limited
    /// partner makes, and the judge decides when to draw against it.
    function commitCapital(address judge, uint256 amount) external onlyOperator {
        Judge storage j = judges[judge];
        require(j.active, "not a judge");
        require(amount > 0, "zero amount");

        j.committed += amount;
        totalCommitted += amount;
        emit CapitalCommitted(judge, amount, j.committed);
    }

    /// A capital call, made by the judge itself. It draws against its own undrawn
    /// commitment and the USDC lands in its wallet. No operator involvement: this is the
    /// point at which a judge stops being an account someone tops up and starts being an
    /// investor that manages its own balance sheet.
    function callCapital(uint256 amount) external {
        Judge storage j = judges[msg.sender];
        require(j.active, "not a judge");
        require(amount > 0, "zero amount");
        require(j.called + amount <= j.committed, "exceeds commitment");
        require(amount <= usdc.balanceOf(address(this)), "fund lacks the cash");

        j.called += amount;
        totalCalled += amount;

        require(usdc.transfer(msg.sender, amount), "capital call failed");
        emit CapitalCalled(msg.sender, amount, j.committed - j.called);
    }

    /// A judge invests its own capital into a startup. Called by the judge's own wallet,
    /// so the decision is authorized onchain by the judge itself, and the USDC moves from
    /// the judge's balance straight to the startup. The judge must approve this contract
    /// to spend its USDC first.
    function invest(address startup, uint256 amount, uint16 revenueShareBps, string calldata pitchRef)
        external
        returns (uint256 dealId)
    {
        Judge storage j = judges[msg.sender];
        require(j.active, "not a judge");
        require(startup != address(0), "zero startup");
        require(amount > 0, "zero amount");
        require(revenueShareBps <= 10000, "bps too high");
        require(address(revenueShare) != address(0), "no revenueShare");

        dealId = deals.length;
        deals.push(
            Deal({
                judge: msg.sender,
                startup: startup,
                amount: amount,
                revenueShareBps: revenueShareBps,
                returned: 0,
                status: DealStatus.Active,
                pitchRef: pitchRef
            })
        );

        j.deployed += amount;
        totalDeployed += amount;
        totalOutstanding += amount;

        revenueShare.registerDeal(dealId, startup, revenueShareBps);
        // Straight from the judge's wallet to the startup. The judge's own balance is the
        // only spending limit there is.
        require(usdc.transferFrom(msg.sender, startup, amount), "capital transfer failed");

        emit Invested(dealId, msg.sender, startup, amount, revenueShareBps);
    }

    /// Called only by RevenueShare when a startup's revenue-share cut arrives back. The
    /// cut lands in this contract, so returns accrue to the LPs and are attributed to the
    /// judge that made the deal.
    function recordReturn(uint256 dealId, uint256 amount) external {
        require(msg.sender == address(revenueShare), "only revenueShare");
        Deal storage d = deals[dealId];
        d.returned += amount;
        totalReturned += amount;

        // A judge's winnings raise what it may draw later. The cash stays in the fund
        // until the judge calls for it, so backing winners earns the right to more
        // capital rather than an automatic payout.
        Judge storage j = judges[d.judge];
        j.returned += amount;
        j.committed += amount;
        totalCommitted += amount;

        emit ReturnRecorded(dealId, amount);
        emit CapitalCommitted(d.judge, amount, j.committed);
    }

    function closeDeal(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(msg.sender == operator || msg.sender == d.judge, "not authorized");
        require(d.status == DealStatus.Active, "not active");
        d.status = DealStatus.Closed;
        totalOutstanding -= d.amount;
        emit DealClosed(dealId);
    }

    // --- views ---

    function cash() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// What a judge can actually spend right now: the USDC in its own wallet.
    function judgeBudget(address judge) external view returns (uint256) {
        return usdc.balanceOf(judge);
    }

    /// Commitment a judge has not yet drawn. What it could call for today, subject to the
    /// fund actually holding the cash.
    function undrawn(address judge) public view returns (uint256) {
        Judge storage j = judges[judge];
        return j.committed > j.called ? j.committed - j.called : 0;
    }

    /// Cash in the fund, capital sitting in judges' wallets, and the book value of live
    /// positions. A capital call moves USDC but does not change what the fund is worth,
    /// so NAV has to count the judges' balances too.
    function nav() external view returns (uint256) {
        uint256 total = usdc.balanceOf(address(this)) + totalOutstanding;
        for (uint256 i = 0; i < judgeList.length; i++) {
            total += usdc.balanceOf(judgeList[i]);
        }
        return total;
    }

    function judgeCount() external view returns (uint256) {
        return judgeList.length;
    }

    function dealCount() external view returns (uint256) {
        return deals.length;
    }

    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return deals[dealId];
    }

    function getJudge(address judge) external view returns (Judge memory) {
        return judges[judge];
    }

    function judgeRoiBps(address judge) external view returns (uint256) {
        Judge storage j = judges[judge];
        if (j.deployed == 0) return 0;
        return (j.returned * 10000) / j.deployed;
    }
}
