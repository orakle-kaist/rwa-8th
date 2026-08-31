// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library IntentTypes {
    struct PrimaryOrderIntent {
        bytes16 orderId;
        address investor;
        string securityId;
        uint256 shareQuantity;
        uint256 krwLimitPrice;
        string targetTradingDate;
        string fundingMode;
        uint256 fundingAmountMinor;
        uint256 nonce;
        uint256 expiresAt;
        bytes32 policyVersion;
    }

    struct SecondaryOrderIntent {
        bytes16 orderId;
        bytes16 quoteId;
        address investor;
        address token;
        string investorSide;
        string paymentMode;
        bytes32 paymentAssetId;
        uint256 shareQuantity;
        uint256 paymentAmountMinor;
        uint256 nonce;
        uint256 expiresAt;
        bytes32 policyVersion;
    }

    struct RedemptionIntent {
        bytes16 redemptionId;
        address investor;
        address token;
        uint256 shareQuantity;
        uint256 krwLimitPrice;
        string targetTradingDate;
        uint256 nonce;
        uint256 expiresAt;
        bytes32 policyVersion;
    }

    struct MarketMakerQuote {
        bytes16 quoteId;
        address marketMaker;
        address token;
        string marketMakerSide;
        string paymentMode;
        bytes32 paymentAssetId;
        uint256 shareQuantity;
        uint256 unitPriceMinor;
        uint256 nonce;
        uint256 expiresAt;
        bytes32 policyVersion;
    }

    struct BrokerSettlementApproval {
        bytes16 approvalId;
        bytes16 orderId;
        address investor;
        address marketMaker;
        address token;
        string paymentMode;
        bytes32 paymentAssetId;
        uint256 shareQuantity;
        uint256 paymentAmountMinor;
        bytes32 rightsEvidenceHash;
        bytes32 fundsEvidenceHash;
        uint256 nonce;
        uint256 expiresAt;
        bytes32 policyVersion;
    }
}
