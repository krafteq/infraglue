import { Provider } from '@platform-tools/provider-core';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
export class TerraformProvider extends Provider {
    constructor() {
        super();
    }
    getProviderName() {
        return 'terraform';
    }
    async getPlan(configuration, input) {
        try {
            await this.checkTerraformInstallation();
            await this.initializeTerraform(configuration);
            const variables = Object.entries(input)
                .map(([key, value]) => `-var "${key}=${value}"`)
                .join(' ');
            const { stdout } = await execAsync(`terraform plan --json ${variables}`, {
                cwd: configuration.rootPath,
            });
            const parsedResults = JSON.parse(`[${stdout.trimEnd().replace(/\n/g, ',')}]`);
            const outputs = parsedResults.filter((result) => result.type === 'outputs');
            // TODO: fix the types
            return {
                text: stdout,
                output: outputs.reduce((acc, result) => {
                    if (result.type === 'outputs') {
                        return {
                            ...acc,
                            // TODO: why it cannot determine the type of the value?
                            ...Object.fromEntries(Object.entries(result.outputs).map(([key, value]) => [
                                key,
                                // TODO: it is the most interesting challenge, we don't have the real value here,
                                // so for generating the plan of dependent projects, we need to create a fake one??? maybe I just missed something???
                                value.value || 'TO_BE_DEFINED',
                            ])),
                        };
                    }
                    return acc;
                }, {}),
            };
        }
        catch (error) {
            if (error instanceof Error) {
                const err = error;
                throw new Error(`Terraform plan failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`);
            }
            throw error;
        }
    }
    async apply(configuration, input) {
        try {
            await this.checkTerraformInstallation();
            await this.initializeTerraform(configuration);
            const variables = Object.entries(input)
                .map(([key, value]) => `-var "${key}=${value}"`)
                .join(' ');
            await execAsync(`terraform apply --auto-approve --json ${variables}`, {
                cwd: configuration.rootPath,
            });
            const { stdout: outputStdout } = await execAsync(`terraform output --json`, {
                cwd: configuration.rootPath,
            });
            const outputs = JSON.parse(outputStdout);
            return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.value]));
        }
        catch (error) {
            if (error instanceof Error) {
                const err = error;
                throw new Error(`Terraform apply failed: ${error.message}\n  error code: ${err.code}\n error stderr: ${err.stderr}`);
            }
            throw error;
        }
    }
    async checkTerraformInstallation() {
        try {
            await execAsync('terraform version');
        }
        catch {
            throw new Error('Terraform is not installed or not available in PATH');
        }
    }
    async initializeTerraform(configuration) {
        try {
            await execAsync('terraform init', { cwd: configuration.rootPath });
        }
        catch (error) {
            throw new Error(`Failed to initialize Terraform: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
//# sourceMappingURL=terraform-provider.js.map