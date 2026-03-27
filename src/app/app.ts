import { Component } from '@angular/core';
import { ChessBoardComponent } from './components/chess-board.component';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [ChessBoardComponent],
    templateUrl: './app.html', 
    styleUrl: './app.scss'     
})
export class AppComponent { 
    title = 'undone-chess-studio';
    testOutput(moveData: any) {
        console.log('Output detected: ', moveData)
    }
}