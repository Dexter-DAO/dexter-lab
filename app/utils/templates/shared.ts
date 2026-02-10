/**
 * Shared template file generators
 *
 * Used by all x402 resource templates for package.json, Dockerfile, and tsconfig.
 */

export const packageJson = (name: string, extraDeps?: Record<string, string>) => {
  const deps: Record<string, string> = {
    '@dexterai/x402': '^1.6.0',
    express: '^4.18.0',
    ...extraDeps,
  };

  return JSON.stringify(
    {
      name,
      version: '1.0.0',
      type: 'module',
      main: 'index.ts',
      scripts: { start: 'tsx index.ts', dev: 'tsx watch index.ts' },
      dependencies: deps,
      devDependencies: {
        tsx: '^4.0.0',
        '@types/express': '^4.17.0',
        typescript: '^5.0.0',
      },
    },
    null,
    2,
  );
};

export const dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`;

export const tsconfig = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      outDir: 'dist',
    },
    include: ['*.ts'],
  },
  null,
  2,
);
