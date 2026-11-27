// Name and location of a stop, cached for a week.
import { fetchStop, type Stop } from './api';
import { cacheGet, cacheSet } from './store';

export type StopInfo = Pick<Stop, 'common_name' | 'long_name' | 'indicator' | 'location'>;

export async function getStopInfo(atco: string): Promise<StopInfo | null> {
  const key = `stop:${atco}`;
  const cached = cacheGet<StopInfo>(key) ?? null;
  // Older versions cached stops without a location.
  if (cached?.location) return cached;
  const stop = await fetchStop(atco);
  if (!stop) return null;
  const info = {
    common_name: stop.common_name,
    long_name: stop.long_name,
    indicator: stop.indicator,
    location: stop.location,
  };
  cacheSet(key, info, 7 * 24 * 60 * 60_000);
  return info;
}
