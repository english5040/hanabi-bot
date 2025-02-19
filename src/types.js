// @ts-nocheck

import { CLUE, ACTION } from './constants.js';
import { Card } from './basics/Card.js';

/**
 * @typedef BasicCard
 * @property {number} suitIndex
 * @property {number} rank 
 * 
 * @typedef BaseClue
 * @property {typeof CLUE.COLOUR | typeof CLUE.RANK} type
 * @property {number} value
 * 
 * @typedef {BaseClue & {target: number, result?: ClueResult}} Clue
 * @typedef {Clue & {playable: boolean, cm: Card[]}} SaveClue
 * @typedef {Clue & {urgent: boolean, trash: boolean}} FixClue
 * 
 * @typedef ClueResult
 * @property {number} elim
 * @property {number} new_touched
 * @property {number} bad_touch
 * @property {number} trash
 * @property {number} finesses
 * @property {number} remainder
 * @property {({playerIndex: number, card: Card})[]} playables
 * 
 * @typedef StatusAction
 * @property {'status'} type
 * @property {number}   clues
 * @property {number}   score
 * @property {number}   maxScore
 * 
 * @typedef TurnAction
 * @property {'turn'}   type
 * @property {number}   num
 * @property {number}   currentPlayerIndex
 * 
 * @typedef ClueAction
 * @property {'clue'}   type
 * @property {number} 	giver
 * @property {number} 	target
 * @property {number[]} list
 * @property {BaseClue} clue
 * @property {boolean}  [mistake]
 * @property {boolean}  [ignoreStall]
 * 
 * @typedef CardAction
 * @property {number} order
 * @property {number} playerIndex
 * @property {number} suitIndex
 * @property {number} rank
 * 
 * @typedef {CardAction & {type: 'draw'}} DrawAction
 * @typedef {CardAction & {type: 'play'}} PlayAction
 * @typedef {CardAction & {type: 'identify', infer?: boolean}} IdentifyAction
 * @typedef {{type: 'ignore', playerIndex: number, conn_index: number}} IgnoreAction
 * @typedef {{type: 'finesse', list: number[], clue: BaseClue}} FinesseAction
 * @typedef {CardAction & {type: 'discard', failed: boolean}} DiscardAction
 * 
 * @typedef GameOverAction
 * @property {'gameOver'}   type
 * @property {number}       endCondition
 * @property {number}       playerIndex
 * @property {any}          votes
 * 
 * @typedef {StatusAction | TurnAction | ClueAction | DrawAction | DiscardAction | PlayAction | GameOverAction | IdentifyAction | IgnoreAction | FinesseAction} Action
 * 
 * @typedef PerformAction
 * @property {number} tableID
 * @property {ACTION[keyof ACTION]} type
 * @property {number} target
 * @property {number} [value]
 * 
 * @typedef Connection
 * @property {'known' | 'playable' | 'prompt' | 'finesse' | 'terminate'} type
 * @property {number} reacting
 * @property {Card} card
 * @property {boolean} [self]
 * @property {boolean} [hidden]
 * @property {boolean} [known]
 * 
 * @typedef WaitingConnection
 * @property {Connection[]} connections
 * @property {number} giver
 * @property {number} [conn_index]
 * @property {Card} focused_card
 * @property {{suitIndex: number, rank: number}} inference
 * @property {number} action_index
 * @property {boolean} [ambiguousPassback]
 * 
 * @typedef Link
 * @property {Card[]} cards
 * @property {BasicCard[]} identities
 * @property {boolean} promised
 */

export {};
