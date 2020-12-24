/* =======================================
 *           Node.js Modules
 * ===================================== */
import { EventEmitter } from 'events';
import { T, Twit } from './twit';

/* =======================================
 *         My Modules and Utils
 * ===================================== */
import {
  logError,
  logSuccess,
  prettyPrintInTable,
  printWelcomeBanner,
  writeToFile,
} from './logger';

import {
  favourite,
  fillArrayWithWords,
  getTweetFullText,
  isDebugModeEnabled,
  isRetweet,
  isRetweetedByMyself,
  loadJSONFileContent,
  removeRetweetNotation,
  removeSuspiciousWords,
  removeURLs,
  retweet,
  store,
  validateInitialTweet,
} from './utils';

/* =======================================
 *            Error Handling
 * ==================================== */
class Emitter extends EventEmitter {}

const emitter: Emitter = new Emitter();

emitter.on('bot-error', (err: any) => {
  logError('An error has been thrown', err.message || err);
});

/* Deal w/ uncaught errors and unhandled promises */
process
  .on('uncaughtException', (err: Error) => {
    logError(`${new Date().toUTCString()} "uncaughtException": ${err.message}`);
    logError(err.stack);
    process.exit(1);
  })
  .on('unhandledRejection', (reason, p: Promise<any>) => {
    logError('Unhandled Rejection at Promise', p);
    logError(reason);
  });

/* =======================================
 *                 Bot
 * ==================================== */
printWelcomeBanner();

const wordsToFollowDB: string[] | Error = loadJSONFileContent(
  `${__dirname}/../data/words-to-follow.json`,
);
const wordsNotToFollowDB: string[] | Error = loadJSONFileContent(
  `${__dirname}/../data/words-not-to-follow.json`,
);

if (wordsToFollowDB instanceof Error || wordsNotToFollowDB instanceof Error) {
  emitter.emit('bot-error', "Files couldn't be loaded");
  process.exit(1);
}

let interestingWords: string[] = [];

interestingWords = fillArrayWithWords(interestingWords, wordsToFollowDB);

const params: Twit.Params = {
  // track these words
  track: interestingWords,
};

// eslint-disable-next-line import/prefer-default-export
export const stream: Twit.Stream = T.stream('statuses/filter', params);

/**
 * onTweet handler - Runs for each tweet that comes from the stream
 * @param tweet - The tweet object
 * @return void
 */
export const onTweet = (tweet: any): number => {
  if (!validateInitialTweet(tweet)) {
    return 0;
  }

  tweet.$tweetText = removeRetweetNotation(getTweetFullText(tweet));

  tweet.$retweetText = '';

  if (isRetweet(tweet)) {
    tweet.$retweetText = removeRetweetNotation(
      getTweetFullText(tweet.retweeted_status),
    );
  }

  let tweetId = 0;

  const tweetTextWithoutURLs: string = removeURLs(tweet.$tweetText);
  const reTweetTextWithoutURLs: string = removeURLs(tweet.$retweetText);

  const tweetTextWithoutSuspiciousWords: string = removeSuspiciousWords(
    tweetTextWithoutURLs,
  );
  const retweetTextWithoutSuspiciousWords: string = removeSuspiciousWords(
    reTweetTextWithoutURLs,
  );

  const tweetIncludesInterestingWords: boolean = interestingWords.some(
    (word: string) => (
      tweetTextWithoutSuspiciousWords.search(
        new RegExp(word.toLowerCase()),
      ) > -1
    ),
  );

  const tweetIncludesBlackListedWords: boolean = wordsNotToFollowDB.some(
    (word: string) => (
      tweetTextWithoutSuspiciousWords.search(
        new RegExp(word.toLowerCase()),
      ) > -1
    ),
  );

  const retweetIncludesBlackListedWords: boolean = wordsNotToFollowDB.some(
    (blackListedWord: string) => (
      retweetTextWithoutSuspiciousWords.search(
        new RegExp(blackListedWord.toLowerCase()),
      ) > -1
    ),
  );

  tweetId = tweetIncludesInterestingWords
    && !tweetIncludesBlackListedWords
    && !retweetIncludesBlackListedWords
    && !isRetweetedByMyself(tweet) ? tweet.id : 0;

  if (tweetId) {
    if (isDebugModeEnabled()) {
      writeToFile(tweet.$tweetText);
      prettyPrintInTable(tweet);
    } else {
      retweet(tweetId)
        .then(({ message }) => {
          logSuccess(message);
        })
        .catch((err) => {
          emitter.emit('bot-error', err);
        });

      favourite(tweetId)
        .then(({ message: m }) => {
          logSuccess(m);
        })
        .catch((err) => {
          emitter.emit('bot-error', err);
        });
    }

    store(tweet)
      .then(({ message }) => {
        logSuccess(message);
      })
      .catch((err) => {
        emitter.emit('bot-error', err);
      });
  }

  return tweetId;
};

stream.on('tweet', onTweet);

stream.on('error', (err: any) => {
  emitter.emit('bot-error', err);
});
