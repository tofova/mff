import { unstable_noStore as noStore } from 'next/cache';
import { getRecentCleanups } from './actions';
import NotificationCleanup from './_components/notification-cleanup';

export default async function NotificationCleanupPage() {
    noStore();
    const recentBatches = await getRecentCleanups();
    return <NotificationCleanup initialBatches={recentBatches} />;
}
