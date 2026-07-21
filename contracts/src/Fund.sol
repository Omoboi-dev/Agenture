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

/// The capital pool. Holds USDC, onboards judges with spending mandates, and lets each
/// judge independently invest its own budget into startup agents. Revenue-share returns
/// are routed back here by RevenueShare and attributed to the judge that made the deal.
contract Fund {
    struct Judge {
        bool active;
        uint256 agentId; // ERC-8004 identity, for off-chain reputation attribution
        uint256 mandate; // max USDC this judge may deploy
        uint256 deployed; // USDC deployed so far
        uint256 returned; // revenue-share received back so far
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
    uint256 public totalDeployed; // cumulative invested into deals
    uint256 public totalReturned; // cumulative revenue-share received back
    uint256 public totalOutstanding; // book value of active positions

    mapping(address => Judge) public judges;
    Deal[] public deals;

    event CapitalDeposited(address indexed from, uint256 amount);
    event JudgeRegistered(address indexed judge, uint256 agentId, uint256 mandate);
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

    function registerJudge(address judge, uint256 agentId, uint256 mandate) external onlyOperator {
        judges[judge] = Judge({active: true, agentId: agentId, mandate: mandate, deployed: 0, returned: 0});
        emit JudgeRegistered(judge, agentId, mandate);
    }

    /// A registered judge invests its own budget into a startup. Called by the judge's
    /// own wallet, so the decision is authorized onchain by the judge itself.
    function invest(address startup, uint256 amount, uint16 revenueShareBps, string calldata pitchRef)
        external
        returns (uint256 dealId)
    {
        Judge storage j = judges[msg.sender];
        require(j.active, "not a judge");
        require(amount > 0, "zero amount");
        require(revenueShareBps <= 10000, "bps too high");
        require(j.deployed + amount <= j.mandate, "over mandate");
        require(amount <= usdc.balanceOf(address(this)), "insufficient capital");
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
        require(usdc.transfer(startup, amount), "capital transfer failed");

        emit Invested(dealId, msg.sender, startup, amount, revenueShareBps);
    }

    /// Called only by RevenueShare when a startup's revenue-share cut arrives back.
    function recordReturn(uint256 dealId, uint256 amount) external {
        require(msg.sender == address(revenueShare), "only revenueShare");
        Deal storage d = deals[dealId];
        d.returned += amount;
        judges[d.judge].returned += amount;
        totalReturned += amount;
        emit ReturnRecorded(dealId, amount);
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

    /// Cash on hand plus the book value (cost basis) of live positions.
    function nav() external view returns (uint256) {
        return usdc.balanceOf(address(this)) + totalOutstanding;
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
