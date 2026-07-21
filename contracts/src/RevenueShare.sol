// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IFund {
    function recordReturn(uint256 dealId, uint256 amount) external;
}

/// Routes a funded startup's revenue back to the Fund. Each deal carries a revenue-share
/// in bps; when the startup settles revenue, that share is pulled to the Fund and the rest
/// stays with the startup. This is the automatic return stream the fund lives on.
contract RevenueShare {
    struct Terms {
        address startup;
        uint16 revenueShareBps;
        bool registered;
    }

    IERC20 public immutable usdc;
    address public immutable fund;

    mapping(uint256 => Terms) public terms; // dealId => terms
    mapping(uint256 => uint256) public reportedRevenue; // cumulative revenue per deal

    event DealRegistered(uint256 indexed dealId, address indexed startup, uint16 revenueShareBps);
    event Settled(uint256 indexed dealId, uint256 revenueAmount, uint256 cut);

    constructor(address _usdc, address _fund) {
        usdc = IERC20(_usdc);
        fund = _fund;
    }

    function registerDeal(uint256 dealId, address startup, uint16 revenueShareBps) external {
        require(msg.sender == fund, "only fund");
        require(!terms[dealId].registered, "deal exists");
        terms[dealId] = Terms({startup: startup, revenueShareBps: revenueShareBps, registered: true});
        emit DealRegistered(dealId, startup, revenueShareBps);
    }

    /// The startup reports revenue and pays the fund's cut. The startup must first approve
    /// this contract to pull the cut in USDC. Only the cut moves; the remainder is already
    /// the startup's.
    function settle(uint256 dealId, uint256 revenueAmount) external {
        Terms storage t = terms[dealId];
        require(t.registered, "unknown deal");
        require(msg.sender == t.startup, "only startup");

        uint256 cut = (revenueAmount * t.revenueShareBps) / 10000;
        reportedRevenue[dealId] += revenueAmount;

        if (cut > 0) {
            require(usdc.transferFrom(t.startup, fund, cut), "cut transfer failed");
            IFund(fund).recordReturn(dealId, cut);
        }
        emit Settled(dealId, revenueAmount, cut);
    }
}
