import { execSync } from 'child_process';

function main() {
  console.log('Running database migrations...');

  try {
    execSync('pnpm --filter bot db:migrate', { stdio: 'inherit' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
