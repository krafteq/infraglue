#!/usr/bin/env node
import { Command } from 'commander';
import { getPlatformConfiguration, getProvider } from '@platform-tools/provider-core';
import { resolve } from 'path';
const program = new Command();
program.name('platform').description('CLI tool for platform-tools').version('1.0.0');
program
    .command('plan')
    .description('Plan the platform configuration for a directory')
    .argument('[directory]', 'Directory to analyze (defaults to current directory)', '.')
    .action(async (directory) => {
    const resolvedPath = resolve(directory);
    console.log(`Analyzing platform configuration in: ${resolvedPath}`);
    const result = await getPlatformConfiguration(resolvedPath);
    if (!result) {
        console.log('No platform configuration found');
        return;
    }
    const provider = await getProvider(result, process.cwd());
    const plan = await provider.getPlan(result, {});
    console.log(plan.text);
    console.log('\n\nOutputs:');
    console.log(JSON.stringify(plan.output, null, 2));
});
program
    .command('show')
    .description('Parse and show platform configuration for a directory')
    .argument('[directory]', 'Directory to analyze (defaults to current directory)', '.')
    .option('-j, --json', 'Output in JSON format')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (directory, options) => {
    try {
        const resolvedPath = resolve(directory);
        console.log(`Analyzing platform configuration in: ${resolvedPath}`);
        const result = await getPlatformConfiguration(resolvedPath);
        if (!result) {
            console.log('No platform configuration found');
            return;
        }
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        }
        else {
            displayPlatformInfo(result, options.verbose);
        }
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
function displayPlatformInfo(result, verbose = false) {
    console.log('\n📋 Platform Configuration Summary');
    console.log('=====================================');
    console.log(`\n🏭 Provider: ${result.provider}`);
    if (Object.keys(result.workspaces).length > 0) {
        console.log(`\n📁 Workspaces (${Object.keys(result.workspaces).length}):`);
        Object.entries(result.workspaces).forEach(([name, workspace]) => {
            console.log(`  • ${name} (${workspace.provider})`);
            if (verbose && Object.keys(workspace.workspaces).length > 0) {
                console.log(`    └─ Sub-workspaces: ${Object.keys(workspace.workspaces).join(', ')}`);
            }
        });
    }
    else {
        console.log('\n📁 No workspaces found');
    }
    if (Object.keys(result.injections).length > 0) {
        console.log(`\n🔗 Injections (${Object.keys(result.injections).length}):`);
        Object.entries(result.injections).forEach(([key, injection]) => {
            console.log(`  • ${key} → ${injection.workspace}:${injection.key}`);
        });
    }
    if (result.output && Object.keys(result.output).length > 0) {
        console.log(`\n📤 Outputs (${Object.keys(result.output).length}):`);
        Object.entries(result.output).forEach(([key, output]) => {
            console.log(`  • ${key} ← ${output.workspace}:${output.key}`);
        });
    }
    if (verbose) {
        console.log('\n🔍 Detailed Information:');
        console.log(JSON.stringify(result, null, 2));
    }
}
program.parse();
//# sourceMappingURL=index.js.map