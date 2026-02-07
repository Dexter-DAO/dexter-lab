import React, { useState, useEffect, useCallback } from 'react';

const EXAMPLE_PROMPTS = [
  { text: 'Build me a paid API that generates dad jokes' },
  { text: 'Create a Solana token analysis service' },
  { text: 'Make an AI writing assistant resource' },
  { text: 'Build a weather API that charges per request' },
  { text: 'Create a code review service using Claude' },
  { text: 'Make an image generation API with DALL-E' },
];

interface ExamplePromptsProps {
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
}

export function ExamplePrompts({ sendMessage }: ExamplePromptsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);

      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % EXAMPLE_PROMPTS.length);
        setIsVisible(true);
      }, 400);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      sendMessage?.(event, EXAMPLE_PROMPTS[currentIndex].text);
    },
    [sendMessage, currentIndex],
  );

  return (
    <div className="flex justify-center w-full max-w-2xl mx-auto mb-3">
      <button
        onClick={handleClick}
        className={`
          border border-bolt-elements-borderColor rounded-full
          bg-gray-50 hover:bg-gray-100 dark:bg-gray-950 dark:hover:bg-gray-900
          text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary
          px-4 py-1.5 text-xs
          transition-all duration-300 ease-in-out cursor-pointer
          ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}
        `}
      >
        {EXAMPLE_PROMPTS[currentIndex].text}
      </button>
    </div>
  );
}
