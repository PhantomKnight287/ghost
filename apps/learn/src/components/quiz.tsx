"use client";

import { useState } from "react";

/** One multiple-choice question: pick an answer, see whether it is right and why. */
export function Question({
  prompt,
  options,
  answer,
  explanation,
}: {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  return (
    <fieldset className="not-prose my-4 rounded-lg border p-4">
      <legend className="px-1 font-medium">{prompt}</legend>
      <div className="mt-2 flex flex-col gap-2">
        {options.map((option, index) => {
          const state = !answered
            ? "border-fd-border hover:bg-fd-accent"
            : index === answer
              ? "border-green-600 bg-green-600/10"
              : index === picked
                ? "border-red-600 bg-red-600/10"
                : "border-fd-border opacity-60";
          return (
            <button
              key={option}
              type="button"
              disabled={answered}
              onClick={() => setPicked(index)}
              className={`rounded-md border px-3 py-2 text-left text-sm ${state}`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className="mt-3 text-sm">
          <strong>{picked === answer ? "Right." : "Not quite."}</strong>{" "}
          {explanation}
        </p>
      )}
      {answered && (
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="mt-2 text-xs underline"
        >
          Try again
        </button>
      )}
    </fieldset>
  );
}

/** A set of questions at the end of a lesson. */
export function Quiz({ children }: { children: React.ReactNode }) {
  return (
    <section className="my-6">
      <h3>Check yourself</h3>
      {children}
    </section>
  );
}
