"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { useEffect, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

interface FromNowHoverCardProps {
  date: string | Date;
  className?: string;
}

export function FromNowHoverCard({ date, className }: FromNowHoverCardProps) {
  // This must be a client component for timezone detection
  const [tz, setTz] = useState<string>("UTC");
  useEffect(() => {
    if (typeof window !== "undefined" && Intl?.DateTimeFormat) {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, []);

  const d = dayjs(date);
  const utcString = d.utc().format("MMM DD, YYYY, HH:mm:ss");
  const localString = d.tz(tz).format("MMM DD, YYYY, HH:mm:ss");
  const timestamp = d.valueOf();

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className={className}>{d.fromNow()}</span>
      </HoverCardTrigger>
      <HoverCardContent className="text-xs">
        <div className="flex flex-col gap-1">
          <div>
            <b>{tz}</b>: {localString}
          </div>
          <div>
            <b>UTC</b>: {utcString}
          </div>
          <div>
            <b>Timestamp</b>: {timestamp}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
