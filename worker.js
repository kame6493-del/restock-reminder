import 'dotenv/config';
import cron from 'node-cron';
import { processDueReminders } from './services/reminder-sender.js';

console.log('ReStock Reminder Worker started');

// Process reminders every hour
cron.schedule('0 * * * *', async () => {
  try {
    const result = await processDueReminders();
    console.log(`Cron complete: ${result.sent} sent, ${result.skipped} skipped`);
  } catch (err) {
    console.error('Cron error:', err);
  }
});

// Also run immediately on startup
processDueReminders().catch(err => {
  console.error('Initial run error:', err);
});

// Keep process alive
process.on('SIGINT', () => {
  console.log('Worker shutting down');
  process.exit(0);
});
