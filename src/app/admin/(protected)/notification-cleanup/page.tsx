import { unstable_noStore as noStore } from 'next/cache';
import { getCleanupHistory } from './actions';
import NotificationCleanup from './_components/notification-cleanup';

export default async function NotificationCleanupPage() {
    noStore();
    const history = await getCleanupHistory(1);
    return <NotificationCleanup initialHistory={history} />;
}
