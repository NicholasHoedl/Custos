import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out', 'drizzle/**', 'resources/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
)
