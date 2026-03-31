/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/unsys_staking.json`.
 */
export type UnsysStaking = {
  "address": "8fQT7WjAw2BLYJcbTPYxLciPmUgh5GS4Jj2Vo1uhoK2q",
  "metadata": {
    "name": "unsysStaking",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "unsysMint"
        },
        {
          "name": "omegaMint"
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "buybackWallet"
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "revenueVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "proposeAdminTransfer",
      "discriminator": [
        218,
        178,
        115,
        190,
        80,
        107,
        95,
        158
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "acceptAdminTransfer",
      "discriminator": [
        89,
        211,
        96,
        212,
        233,
        0,
        251,
        7
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "newAdmin",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "cancelAdminTransfer",
      "discriminator": [
        38,
        131,
        157,
        31,
        240,
        137,
        44,
        215
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "depositRevenue",
      "discriminator": [
        224,
        212,
        82,
        100,
        60,
        240,
        220,
        29
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "adminUsdcAta",
          "writable": true
        },
        {
          "name": "revenueVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "stakeDividends",
      "discriminator": [
        161,
        224,
        5,
        30,
        92,
        103,
        47,
        69
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "userStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userUnsysAta",
          "writable": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "lockMonths",
          "type": "u8"
        }
      ]
    },
    {
      "name": "unstakeDividends",
      "discriminator": [
        211,
        193,
        244,
        125,
        100,
        133,
        32,
        55
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "userStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userUnsysAta",
          "writable": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimDividends",
      "discriminator": [
        105,
        60,
        172,
        2,
        136,
        93,
        128,
        151
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "userStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "revenueVault",
          "writable": true
        },
        {
          "name": "userUsdcAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimReferralShare",
      "discriminator": [
        228,
        210,
        199,
        63,
        193,
        255,
        205,
        166
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "partnershipStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "revenueVault",
          "writable": true
        },
        {
          "name": "userUsdcAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "registerLegacyHolder",
      "discriminator": [
        163,
        206,
        249,
        52,
        34,
        119,
        33,
        78
      ],
      "accounts": [
        {
          "name": "globalConfig"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "legacyOmegaStake",
          "writable": true
        },
        {
          "name": "holder"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "holder",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "enableLegacyBenefits",
      "discriminator": [
        216,
        89,
        185,
        246,
        230,
        166,
        218,
        121
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "legacyOmegaStake"
        },
        {
          "name": "dividendStake",
          "writable": true
        },
        {
          "name": "partnershipStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "revokeLegacyPartnership",
      "discriminator": [
        111,
        11,
        67,
        2,
        246,
        107,
        114,
        230
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "partnershipStake",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "stakeDataProvider",
      "discriminator": [
        239,
        111,
        156,
        41,
        135,
        169,
        76,
        82
      ],
      "accounts": [
        {
          "name": "globalConfig"
        },
        {
          "name": "dataProviderStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userUnsysAta",
          "writable": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deactivateDataProvider",
      "discriminator": [
        135,
        21,
        125,
        218,
        12,
        126,
        185,
        143
      ],
      "accounts": [
        {
          "name": "globalConfig"
        },
        {
          "name": "dataProviderStake",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "unstakeDataProvider",
      "discriminator": [
        209,
        104,
        77,
        28,
        168,
        96,
        48,
        22
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "dataProviderStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userUnsysAta",
          "writable": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "validateDataProvider",
      "discriminator": [
        193,
        171,
        197,
        72,
        10,
        192,
        166,
        88
      ],
      "accounts": [
        {
          "name": "globalConfig"
        },
        {
          "name": "dataProviderStake",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "stakePartnership",
      "discriminator": [
        128,
        9,
        210,
        114,
        118,
        244,
        25,
        115
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "partnershipStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userUnsysAta",
          "writable": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "referrer",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "unstakePartnership",
      "discriminator": [
        139,
        64,
        29,
        175,
        154,
        5,
        133,
        158
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "writable": true
        },
        {
          "name": "partnershipStake",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenVault",
          "writable": true
        },
        {
          "name": "userUnsysAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amountToUnstake",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "dividendStake",
      "discriminator": [
        247,
        97,
        181,
        177,
        124,
        29,
        208,
        57
      ]
    },
    {
      "name": "legacyOmegaStake",
      "discriminator": [
        251,
        163,
        19,
        43,
        187,
        20,
        79,
        202
      ]
    },
    {
      "name": "partnershipStake",
      "discriminator": [
        158,
        28,
        164,
        191,
        248,
        74,
        81,
        97
      ]
    },
    {
      "name": "dataProviderStake",
      "discriminator": [
        73,
        63,
        159,
        49,
        65,
        62,
        238,
        95
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized"
    },
    {
      "code": 6001,
      "name": "invalidLockPeriod"
    },
    {
      "code": 6002,
      "name": "noActiveStake"
    },
    {
      "code": 6003,
      "name": "insufficientStake"
    },
    {
      "code": 6004,
      "name": "insufficientDataProviderStake"
    },
    {
      "code": 6005,
      "name": "notLegacyOmega"
    },
    {
      "code": 6006,
      "name": "noRevenueToClaim"
    },
    {
      "code": 6007,
      "name": "insufficientRevenue"
    },
    {
      "code": 6008,
      "name": "alreadyInitialized"
    },
    {
      "code": 6009,
      "name": "stakeAlreadyExists"
    },
    {
      "code": 6010,
      "name": "lockPeriodNotExpired"
    },
    {
      "code": 6011,
      "name": "invalidVault"
    },
    {
      "code": 6012,
      "name": "alreadyClaimed"
    },
    {
      "code": 6013,
      "name": "invalidAmount"
    },
    {
      "code": 6014,
      "name": "invalidTokenAccount"
    },
    {
      "code": 6015,
      "name": "mustDeactivateFirst"
    },
    {
      "code": 6016,
      "name": "notActive"
    },
    {
      "code": 6017,
      "name": "invalidAdmin"
    },
    {
      "code": 6018,
      "name": "notLegacyPartner"
    }
  ],
  "types": [
    {
      "name": "globalConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "unsysMint",
            "type": "pubkey"
          },
          {
            "name": "omegaMint",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "tokenVault",
            "type": "pubkey"
          },
          {
            "name": "revenueVault",
            "type": "pubkey"
          },
          {
            "name": "totalDividendShares",
            "type": "u128"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "buybackWallet",
            "type": "pubkey"
          },
          {
            "name": "dividendEpoch",
            "type": "u64"
          },
          {
            "name": "epochDividendPool",
            "type": "u64"
          },
          {
            "name": "epochReferralPool",
            "type": "u64"
          },
          {
            "name": "totalActivePartners",
            "type": "u64"
          },
          {
            "name": "epochActivePartners",
            "type": "u64"
          },
          {
            "name": "epochDividendSnapshot",
            "type": "u64"
          },
          {
            "name": "epochReferralSnapshot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dividendStake",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u128"
          },
          {
            "name": "lockEnd",
            "type": "i64"
          },
          {
            "name": "multiplierBps",
            "type": "u16"
          },
          {
            "name": "lastClaimTs",
            "type": "i64"
          },
          {
            "name": "lastClaimEpoch",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "legacyOmegaStake",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "registered",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "partnershipStake",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "stakedAmount",
            "type": "u64"
          },
          {
            "name": "referrer",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "lastClaimEpoch",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dataProviderStake",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "stakedAmount",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
