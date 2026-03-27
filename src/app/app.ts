import { Component } from '@angular/core';
import { ChessBoardComponent } from './components/chess-board.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ChessBoardComponent],
  templateUrl: './app.html', // Verifică să fie numele fișierului tău html
  styleUrl: './app.scss'     // Verifică să fie numele fișierului tău scss
})
export class AppComponent { // <--- Verifică dacă aici scrie 'AppComponent' sau doar 'App'
  title = 'undone-chess-studio';
}