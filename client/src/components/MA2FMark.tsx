import { Droplets } from "lucide-react";

interface MA2FMarkProps {
  className?: string;
}

export function MA2FMark({ className }: MA2FMarkProps) {
  return (
    <span role="img" aria-label="MA2F" className="inline-flex items-center justify-center">
      <Droplets className={className} aria-hidden="true" strokeWidth={2} />
    </span>
  );
}