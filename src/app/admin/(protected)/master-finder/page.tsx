import { unstable_noStore as noStore } from 'next/cache';
import { getRecentFinderConversions, getRecentFinderScans } from './actions';
import MasterFinder from './_components/master-finder';

export default async function MasterFinderPage() {
    noStore();
    const [recentJobs, recentConversions] = await Promise.all([getRecentFinderScans(), getRecentFinderConversions()]);
    return <MasterFinder initialJobs={recentJobs} initialConversions={recentConversions} />;
}
