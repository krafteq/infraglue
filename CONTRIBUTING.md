# Contributing to Infra Glue

Thank you for your interest in contributing to Infra Glue! This document provides guidelines and information for contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)

## Getting Started

Before you begin contributing, please ensure you have:

- Node.js >= 22.10.0
- pnpm >= 10.12.1 (required package manager)
- Git

## Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/your-username/infra-glue.git
   cd infra-glue
   ```

2. **Install dependencies**

   ````bash
   pnpm install
   ```3. **Set up Git hooks**
   ```bash
   pnpm prepare
   ````

## Code Style

This project uses several tools to maintain code quality:

### ESLint

- Run linting: `pnpm lint`
- Auto-fix issues: `pnpm lint:fix`

### Prettier

- Format code: `pnpm format`

### Pre-commit Hooks

The project uses Husky and lint-staged to automatically:

- Run ESLint on staged JavaScript/TypeScript files
- Format all staged files with Prettier

## Commit Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Commit Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

### Examples

```bash
feat: add new validation utility
fix: resolve memory leak in data processor
docs: update README with installation instructions
style: format code according to prettier rules
```

### Using Commitizen

To ensure proper commit format, use:

```bash
pnpm commit
```

## Pull Request Process

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

   - Follow the code style guidelines
   - Add tests if applicable
   - Update documentation as needed

3. **Test your changes**

   ```bash
   pnpm lint
   pnpm format
   ```

4. **Commit your changes**

   ```bash
   pnpm commit
   ```

5. **Push to your fork**

   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**
   - Provide a clear description of the changes
   - Reference any related issues
   - Ensure all CI checks pass

## Reporting Issues

When reporting issues, please include:

- **Description**: Clear and concise description of the problem
- **Steps to reproduce**: Detailed steps to reproduce the issue
- **Expected behavior**: What you expected to happen
- **Actual behavior**: What actually happened
- **Environment**: OS, Node.js version, pnpm version
- **Additional context**: Any other relevant information

## Code of Conduct

This project is committed to providing a welcoming and inclusive environment for all contributors. Please be respectful and constructive in all interactions.

**Please note that this project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).** By participating, you are expected to uphold this code. Please report unacceptable behavior to conduct@krafteq.de.

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.

## Questions?

If you have any questions about contributing, please open an issue or reach out to the maintainers.

Thank you for contributing to Infra Glue! 🚀
