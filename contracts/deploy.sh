#!/usr/bin/env bash
# Deploy Fund + RevenueShare to Arc testnet and wire them together.
#
# The two contracts reference each other, so the order matters: Fund first, then
# RevenueShare with the Fund's address, then setRevenueShare back on the Fund.
#
# Usage: ./deploy.sh    (reads contracts/.env)
set -euo pipefail

cd "$(dirname "$0")"
set -a && source .env && set +a

USDC=0x3600000000000000000000000000000000000000
OPERATOR=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")

echo "Deploying as operator $OPERATOR"
echo

FUND=$(forge create src/Fund.sol:Fund \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --constructor-args "$USDC" "$OPERATOR" \
  | grep '^Deployed to:' | awk '{print $3}')
echo "Fund          $FUND"
sleep 3

RS=$(forge create src/RevenueShare.sol:RevenueShare \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --constructor-args "$USDC" "$FUND" \
  | grep '^Deployed to:' | awk '{print $3}')
echo "RevenueShare  $RS"
sleep 3

cast send "$FUND" "setRevenueShare(address)" "$RS" \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null
echo "Wired RevenueShare into Fund."
echo
echo "Update shared/addresses.json:"
echo "  agenture.fund         = $FUND"
echo "  agenture.revenueShare = $RS"
