import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// Memorable quotes from Willy Wonka and the Chocolate Factory (1971)
const wonkaQuotes = [
  {
    quote: "A little nonsense now and then is relished by the wisest men.",
    character: "Willy Wonka",
    context: "Wonka's philosophy on life"
  },
  {
    quote: "We are the music makers, and we are the dreamers of dreams.",
    character: "Willy Wonka",
    context: "Quoting Arthur O'Shaughnessy during the boat ride"
  },
  {
    quote: "So shines a good deed in a weary world.",
    character: "Willy Wonka",
    context: "When Charlie returns the Everlasting Gobstopper"
  },
  {
    quote: "The suspense is terrible. I hope it'll last.",
    character: "Willy Wonka",
    context: "During the golden ticket frenzy"
  },
  {
    quote: "Invention, my dear friends, is 93% perspiration, 6% electricity, 4% evaporation, and 2% butterscotch ripple.",
    character: "Willy Wonka",
    context: "Explaining his creative process"
  },
  {
    quote: "Time is a precious thing. Never waste it.",
    character: "Willy Wonka",
    context: "Advice given during the factory tour"
  },
  {
    quote: "If you want to view paradise, simply look around and view it.",
    character: "Willy Wonka",
    context: "Singing 'Pure Imagination'"
  },
  {
    quote: "Anything you want to, do it. Want to change the world? There's nothing to it.",
    character: "Willy Wonka",
    context: "From the song 'Pure Imagination'"
  },
  {
    quote: "There is no life I know to compare with pure imagination.",
    character: "Willy Wonka",
    context: "The essence of the Chocolate Room"
  },
  {
    quote: "We have so much time and so little to do. Strike that, reverse it.",
    character: "Willy Wonka",
    context: "Classic Wonka wordplay"
  },
  {
    quote: "Candy is dandy but liquor is quicker.",
    character: "Willy Wonka",
    context: "Quoting Ogden Nash"
  },
  {
    quote: "I'm a trifle deaf in this ear. Speak a little louder next time.",
    character: "Willy Wonka",
    context: "Ignoring complaints from bad children"
  },
  {
    quote: "Don't forget what happened to the man who suddenly got everything he always wanted... He lived happily ever after.",
    character: "Willy Wonka",
    context: "To Charlie at the end of the film"
  },
  {
    quote: "You lose! Good day, sir!",
    character: "Willy Wonka",
    context: "His famous outburst in the office"
  },
  {
    quote: "I said good day!",
    character: "Willy Wonka",
    context: "Emphatic dismissal"
  },
  {
    quote: "The snozzberries taste like snozzberries!",
    character: "Willy Wonka",
    context: "In the lickable wallpaper room"
  },
  {
    quote: "There's no earthly way of knowing which direction we are going.",
    character: "Willy Wonka",
    context: "The terrifying boat ride"
  },
  {
    quote: "Where is fancy bred? In the heart or in the head?",
    character: "Willy Wonka",
    context: "Quoting Shakespeare at the entrance"
  },
  {
    quote: "A little boy's got to have something in this world to hope for. What's he got to hope for now?",
    character: "Grandpa Joe",
    context: "Defending Charlie's dream"
  },
  {
    quote: "I've got a golden ticket!",
    character: "Charlie Bucket",
    context: "The joyous discovery"
  },
  {
    quote: "Violet, you're turning violet, Violet!",
    character: "Mr. Beauregarde",
    context: "During the blueberry transformation"
  },
  {
    quote: "I want it now!",
    character: "Veruca Salt",
    context: "Her constant demand"
  },
  {
    quote: "What is this, a freak-out?",
    character: "Mike Teevee",
    context: "During the boat ride"
  },
  {
    quote: "Bubbles, bubbles everywhere, but not a drop to drink.",
    character: "Willy Wonka",
    context: "In the Fizzy Lifting Drinks room"
  },
  {
    quote: "Strike that, reverse it. Thank you.",
    character: "Willy Wonka",
    context: "One of his signature phrases"
  }
];

// Health check endpoint (free)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Willy Wonka Quotes API',
    totalQuotes: wonkaQuotes.length
  });
});

// Get a random Wonka quote - $0.005 per quote
app.get('/api/quote',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.005',
    description: 'Get a random Willy Wonka quote',
  }),
  (req, res) => {
    const randomQuote = wonkaQuotes[Math.floor(Math.random() * wonkaQuotes.length)];
    res.json({
      ...randomQuote,
      film: "Willy Wonka and the Chocolate Factory (1971)"
    });
  }
);

// Get a quote by character - $0.005 per quote
app.get('/api/quote/:character',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.005',
    description: 'Get a quote from a specific character',
  }),
  (req, res) => {
    const character = req.params.character.toLowerCase();
    const characterQuotes = wonkaQuotes.filter(q =>
      q.character.toLowerCase().includes(character)
    );

    if (characterQuotes.length === 0) {
      return res.status(404).json({
        error: 'No quotes found for that character',
        availableCharacters: [...new Set(wonkaQuotes.map(q => q.character))]
      });
    }

    const randomQuote = characterQuotes[Math.floor(Math.random() * characterQuotes.length)];
    res.json({
      ...randomQuote,
      film: "Willy Wonka and the Chocolate Factory (1971)"
    });
  }
);

// Get all quotes - $0.02 for the full collection
app.get('/api/quotes',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.02',
    description: 'Get all Willy Wonka quotes',
  }),
  (req, res) => {
    res.json({
      film: "Willy Wonka and the Chocolate Factory (1971)",
      totalQuotes: wonkaQuotes.length,
      quotes: wonkaQuotes
    });
  }
);

// Get Pure Imagination lyrics excerpt - $0.01
app.get('/api/pure-imagination',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.01',
    description: 'Get Pure Imagination song excerpt',
  }),
  (req, res) => {
    res.json({
      song: "Pure Imagination",
      performer: "Gene Wilder as Willy Wonka",
      film: "Willy Wonka and the Chocolate Factory (1971)",
      excerpt: `Come with me and you'll be
In a world of pure imagination
Take a look and you'll see
Into your imagination

We'll begin with a spin
Traveling in the world of my creation
What we'll see will defy explanation

If you want to view paradise
Simply look around and view it
Anything you want to, do it
Want to change the world?
There's nothing to it`,
      note: "One of the most beloved songs in cinema history"
    });
  }
);

// List available characters (free)
app.get('/api/characters', (req, res) => {
  const characters = [...new Set(wonkaQuotes.map(q => q.character))];
  res.json({
    characters,
    hint: "Use GET /api/quote/:character to get quotes from a specific character"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍫 Willy Wonka Quotes API running on port ${PORT}`);
  console.log(`✨ "A little nonsense now and then is relished by the wisest men."`);
});
