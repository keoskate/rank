# Code Quality Setup

This document outlines the code quality tools and standards configured for the stock ranking application.

## Tools Configured

### 1. Prettier (Code Formatting)

- **Purpose**: Automatic code formatting for consistent style
- **Configuration**: `.prettierrc`
- **Ignore Rules**: `.prettierignore`
- **Settings**:
  - 2-space indentation
  - Single quotes for JavaScript
  - Semicolons required
  - 80 character line width
  - Trailing commas where valid

### 2. ESLint (Code Linting)

- **Purpose**: JavaScript error detection and code quality enforcement
- **Configuration**: `.eslintrc.js`
- **Plugins**: React, React Hooks, Prettier integration
- **Key Rules**:
  - React Hooks rules of hooks (error)
  - React Hooks exhaustive deps (warning)
  - No unused variables (warning, with exceptions)
  - Prefer const (warning)
  - No var declarations (error)
  - Prettier formatting errors (error)

### 3. VS Code Integration

- **Auto-format on save** enabled
- **Auto-fix ESLint on save** enabled
- **Recommended extensions** in `.vscode/extensions.json`
- **Workspace settings** in `.vscode/settings.json`

## Available Scripts

### Linting Scripts

```bash
# Run ESLint on all files
npm run lint

# Run ESLint and automatically fix issues
npm run lint:fix
```

### Formatting Scripts

```bash
# Format all files with Prettier
npm run format

# Check if files are formatted (CI/CD)
npm run format:check
```

### Combined Scripts

```bash
# Check both linting and formatting
npm run code-quality

# Fix both linting and formatting issues
npm run code-fix
```

## Workflow Integration

### Development Workflow

1. **Auto-formatting**: Files are automatically formatted on save in VS Code
2. **Auto-fixing**: ESLint issues are automatically fixed on save when possible
3. **Manual quality check**: Run `npm run code-quality` before commits
4. **Manual fixes**: Run `npm run code-fix` to fix all auto-fixable issues

### Pre-commit Recommendations

```bash
# Run this before committing
npm run code-quality
```

### CI/CD Integration (Future)

```bash
# Add to CI pipeline
npm run code-quality
npm run build
npm run test
```

## Configuration Files

### `.prettierrc`

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

### `.eslintrc.js`

- React 18 compatible rules
- React Hooks enforcement
- Prettier integration
- Unused variable warnings (with sensible exceptions)
- Console.log allowed (useful for debugging)

### `.vscode/settings.json`

- Format on save enabled
- ESLint auto-fix on save
- File associations for JSX
- Performance optimizations

## Code Quality Standards

### File Organization

- **One component per file**
- **Clear file naming** (PascalCase for components)
- **Consistent folder structure**
- **Index files** for clean imports

### React Standards

- **Functional components** with hooks
- **Proper hook dependencies** (enforced by ESLint)
- **Component prop validation** (optional - currently disabled)
- **Consistent naming conventions**

### JavaScript Standards

- **ES6+ features** preferred
- **Const/let over var** (enforced)
- **Arrow functions** for consistency
- **Template literals** for string interpolation
- **Destructuring** where appropriate

### Comment Standards

- **JSDoc comments** for complex functions
- **Inline comments** for complex logic
- **TODO comments** with context
- **No commented-out code** in commits

## Benefits

### Developer Experience

- **Consistent formatting** across the team
- **Fewer formatting-related code review comments**
- **Automatic error detection** while typing
- **VS Code integration** for seamless workflow

### Code Quality

- **Reduced bugs** through linting
- **Consistent code style** across the project
- **Better readability** through formatting
- **React best practices** enforcement

### Maintenance

- **Easier refactoring** with consistent code
- **Faster onboarding** for new developers
- **Reduced technical debt** through standards
- **Better collaboration** with shared conventions

## Migration Notes

### What Was Formatted

- All JavaScript/JSX files in the project
- Configuration files (JSON, JS)
- Documentation files (Markdown)
- Build scripts and utilities

### No Breaking Changes

- **All functionality preserved** after formatting
- **Build process unchanged**
- **Runtime behavior identical**
- **Only cosmetic improvements**

## Next Steps

### Immediate

- [x] Prettier configuration and formatting
- [x] ESLint configuration and setup
- [x] VS Code workspace settings
- [x] npm scripts for quality checks

### Future Enhancements

- [ ] Pre-commit hooks (husky + lint-staged)
- [ ] TypeScript integration for better type safety
- [ ] Additional ESLint rules for advanced patterns
- [ ] Performance linting (eslint-plugin-react-perf)
- [ ] Accessibility linting (eslint-plugin-jsx-a11y)
- [ ] Import order enforcement
- [ ] Jest/testing linting rules

### Team Adoption

- [ ] Team training on new tools and workflows
- [ ] Documentation review and updates
- [ ] CI/CD pipeline integration
- [ ] Code review checklist updates

## Troubleshooting

### Common Issues

**ESLint errors after setup:**

- Run `npm run lint:fix` to auto-fix issues
- Check `.eslintrc.js` configuration
- Verify file extensions in ESLint command

**Prettier formatting conflicts:**

- ESLint and Prettier are configured to work together
- Prettier rules override conflicting ESLint formatting rules
- Run `npm run code-fix` to resolve conflicts

**VS Code not auto-formatting:**

- Check if Prettier extension is installed and enabled
- Verify `.vscode/settings.json` is properly configured
- Ensure `editor.defaultFormatter` is set to Prettier

**Build failures after formatting:**

- Formatting should not break builds
- Check for any syntax errors introduced
- Run `npm run build` to verify

### Getting Help

- Check this documentation first
- Review ESLint and Prettier official docs
- Ask team members for configuration questions
- Create GitHub issues for persistent problems
