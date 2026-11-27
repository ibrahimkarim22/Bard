# Bard

Bard is a Shakespeare reading and study app for iOS and Android. Its library holds 38 complete plays, each with an original synopsis and a ten-question quiz. Every answer links back to the text. If you forget whom Lysander falls for under Puck’s spell, you can open the scene and read his first words for yourself.

## Inside the app

- **Library** — Find a play by title or browse comedies, tragedies, histories, and romances. Jump to an act or scene and choose the typeface, text size, line spacing, and theme that suit you.
- **Synopses** — Start with a short introduction, follow the plot act by act, or open the full synopsis when you’re ready to learn the ending.
- **My Highlights** — Mark a passage in color and find it later under the play’s title. Select **Show passage** to return to those lines in context.
- **Guided course** — Each quiz answer comes with an explanation and a supporting passage. A perfect score earns the play’s medal and unlocks the next lesson.

## Try a lesson locally

The standalone preview lets you try the *A Midsummer Night’s Dream* lesson and quiz without a Firebase account. Use Node.js 22 and an Android emulator with an Expo Go build that supports SDK 53. From the repository root, run these commands in PowerShell.

```powershell
npm ci --legacy-peer-deps
$env:EXPO_PUBLIC_BARD_COURSE_UI_TEST = 'isolated'
npm start
```

Press `a` in the Expo terminal to open the emulator. Select **Open Midsummer lesson**, then **Start quiz**. Preview progress lasts for the current session.

## How it’s built

Bard uses React Native, Expo, React Navigation, and Redux Toolkit. The plays, synopses, and quizzes ship with the app. The full app uses Bard’s configured Firebase project for sign-in, course progress, and highlight sync.

From the repository root, these commands check the bundled synopses and verify quiz quotations against the source text.

```sh
node scripts/validateSynopsisCollection.cjs
node scripts/validateQuizCollection.cjs
```

## Credits

Created by Ibrahim Karim. The play texts come from [Project Gutenberg’s edition of *The Complete Works of William Shakespeare*](https://www.gutenberg.org/ebooks/100). Artwork, typeface, and icon credits are available in the app under **About → Sources & credits**.
