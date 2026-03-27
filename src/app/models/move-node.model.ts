import { 
    Color, 
    PieceType,
    BoardColumn,
    BoardRow,
    Annotation
} from './chess-enums';

export interface MoveNode {
    isRoot: boolean,
    color: Color;
    piece: PieceType;
    from: `${BoardColumn}${BoardRow}`; 
    to: `${BoardColumn}${BoardRow}`;         
    annotation?: Annotation; 
    san: string;
    comment?: string;      
    children: MoveNode[];  
    parent: MoveNode | null;
    promotion?: PieceType;
    fen: string;
    drawings?: any[];
}