import { Provider, type PlatformDetectionResult } from '@platform-tools/provider-core';
type ProviderOutput = Record<string, string>;
type ProviderInput = Record<string, string>;
interface ProviderPlan {
    text: string;
    output: ProviderOutput;
}
export declare class TerraformProvider extends Provider {
    constructor();
    getProviderName(): string;
    getPlan(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderPlan>;
    apply(configuration: PlatformDetectionResult, input: ProviderInput): Promise<ProviderOutput>;
    private checkTerraformInstallation;
    private initializeTerraform;
}
export {};
//# sourceMappingURL=terraform-provider.d.ts.map