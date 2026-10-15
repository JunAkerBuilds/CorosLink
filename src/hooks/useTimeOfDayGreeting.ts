import { useEffect, useState } from "react";
import { t, useLanguage } from "../i18n";
import {
  getTimeOfDayGreeting,
  msUntilNextGreetingChange,
} from "../greetings";

export function useTimeOfDayGreeting(): string {
  useLanguage();
  const [greeting, setGreeting] = useState(() => getTimeOfDayGreeting());

  useEffect(() => {
    let timeoutId = 0;

    const scheduleNext = () => {
      timeoutId = window.setTimeout(() => {
        setGreeting(getTimeOfDayGreeting());
        scheduleNext();
      }, msUntilNextGreetingChange());
    };

    scheduleNext();
    return () => window.clearTimeout(timeoutId);
  }, []);

  return t(greeting);
}
