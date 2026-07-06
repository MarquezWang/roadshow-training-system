"use client";

import { useEffect, useState } from "react";

const questions = [
  "竞品复制你，难在哪一步？",
  "为什么大厂不做这个事？",
  "客户不买单，技术再好怎么办？",
  "你的第一个付费客户，在哪里？",
  "示范成功之后，怎么规模化？",
  "如果明天扩大试点，谁来交付？",
];

export function RotatingJudgeQuestion() {
  const [questionIndex, setQuestionIndex] = useState(0);
  const question = questions[questionIndex];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuestionIndex((currentIndex) => (currentIndex + 1) % questions.length);
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <p
      key={questionIndex}
      aria-live="polite"
      className="judge-question-enter mt-3 min-h-12 text-sm font-semibold leading-6 text-white"
    >
      {Array.from(question).map((character, index) => (
        <span
          key={`${questionIndex}-${character}-${index}`}
          className="judge-question-char"
          style={{ animationDelay: `${index * 46}ms` }}
        >
          {character}
        </span>
      ))}
    </p>
  );
}
