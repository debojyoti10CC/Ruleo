import type { CaveatConfig } from "../../caveat-generator";

export interface ERC7715Permission {
    type: string;
    data: Record<string, unknown>;
    isAdjustmentAllowed?: boolean;
}

/**
 * Converts caveat-generator outputs into standard ERC-7715 delegation permissions.
 */
export function convertToPermissions(caveatConfig: CaveatConfig): ERC7715Permission[] {
    return caveatConfig.caveats.map((caveat) => {
        let mappedPermission: ERC7715Permission = {
            type: caveat.type,
            data: {
                justification: caveat.justification,
            },
            isAdjustmentAllowed: true,
        };

        switch (caveat.type) {
            case "native-token-periodic":
                mappedPermission.data = {
                    ...mappedPermission.data,
                    allowance: caveat.params.allowance,
                    periodDuration: caveat.params.periodDuration,
                    startTime: caveat.params.startTime ?? Math.floor(Date.now() / 1000),
                };
                break;

            case "erc20-token-periodic":
                mappedPermission.data = {
                    ...mappedPermission.data,
                    tokenAddress: caveat.params.token,
                    periodAmount: caveat.params.allowance,
                    periodDuration: caveat.params.periodDuration,
                    startTime: caveat.params.startTime ?? Math.floor(Date.now() / 1000),
                };
                break;

            case "erc20-token-allowance":
                mappedPermission.data = {
                    ...mappedPermission.data,
                    tokenAddress: caveat.params.token,
                    allowance: caveat.params.allowance,
                };
                break;

            case "temporal":
                mappedPermission.data = {
                    ...mappedPermission.data,
                    expiry: caveat.params.expiry,
                    scheduleType: caveat.params.scheduleType,
                    day: caveat.params.day,
                };
                break;

            case "price-condition":
                mappedPermission.data = {
                    ...mappedPermission.data,
                    asset: caveat.params.asset,
                    priceBelow: caveat.params.priceBelow,
                    priceAbove: caveat.params.priceAbove,
                    oracleType: caveat.params.oracleType,
                };
                break;

            default:
                mappedPermission.data = {
                    ...mappedPermission.data,
                    ...caveat.params,
                };
                break;
        }

        return mappedPermission;
    });
}
