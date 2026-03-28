# Chess analysis board
A web-responsive chess analysis board built with Angular 21, integrating Chessground for the UI and Stockfish 18 for engine evaluation. This project focuses on providing a functional interface for move-tree management, position setup, and PGN/FEN handling on both desktop and mobile devices. 

## Live Demo:
https://armand-veress.github.io/Chess-Analysis-Board-Template/

## Features:
* Manage Analysis in a **move-tree structure**
* **Set up custom position** for analysis
* Supports **annotations and drawings(shapes)**
* **Import** position from **FEN** or analysis from **PGN**
* **Export** position as **.jpg diagram** or analysis as **PGN file**
* **Copy to clipboard FEN or PGN** in a single click
* **Toggle Engine** for computer analysis

## Technologies stack
* **Framework:** Angular CLI (v21.2.2)
* **Programming languages:** HTML5, CSS3, TypeScript
* **Board UI:** [Chessground](https://github.com/lichess-org/chessground) (by Lichess)
* **Move validation:** [chess.js](https://github.com/jhlywa/chess.js)
* **Engine:** [Stockfish 18 WASM lite single thread version](https://github.com/nmrugg/stockfish.js/?tab=readme-ov-file)

## How to run
* **Option A (Run the full project):**
  1. Clone the repository
  ```
  git clone https://github.com/Armand-Veress/Chess-Analysis-Board-Template.git
  ```
  2. Install dependencies
  ```
  npm install
  ```
  3. Run the development server
  ```
  ng serve
  ```

* **Option B (Use as a standalone component):**
  1. Copy files:
     * (/src/app/components) chess-board.component.html, chess-board.component.css, chess-board.component.ts
     * /src/app/services/engine.service.ts
     * src/app/models
     * (/public) stockfish-18-lite-single.js, stockfish-18-lite-single.wasm
  2. Install dependencies:
     ```
     npm install chessground chess.js
     ```
  3. Import component
     ```
     import { ChessBoardComponent } from './chess-board/chess-board.component';

     @Component({
       standalone: true,
       imports: [ChessBoardComponent],
       template: `<app-chess-board></app-chess-board>`
     })
     ```
  4. Basic usage (@Inputs and @Outputs)
     ```
     <app-chess-board 
       [startingFen]="'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'"
       [autoStartEngine]="false"
       (onMoveMade)="testOutput($event)">
     </app-chess-board>
     ```

## License & Attributions
This project is licensed under the **GPL-3.0 License**.

**Third-party Libraries & Assets:**
* [Chessground](https://github.com/lichess-org/chessground) (GPL-3.0) by [Lichess](https://lichess.org/)
* [Stockfish 18](https://github.com/nmrugg/stockfish.js/?tab=readme-ov-file) (GPL-3.0)
* [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause)


  
