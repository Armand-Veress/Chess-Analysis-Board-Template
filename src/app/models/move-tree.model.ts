import { MoveNode } from './move-node.model';
import { Color } from './chess-enums';

export interface MoveTree {
    root: MoveNode; 
    currentNode: MoveNode | null;
    moveNumber: number; 
    color: Color;
}

