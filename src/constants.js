const ACTION = {
	PLAY: 0,
	DISCARD: 1,
	COLOUR: 2,
	RANK: 3
};

const CLUE = { COLOUR: 0, RANK: 1 };

const CARD_COUNT = [3, 2, 2, 2, 1];

module.exports = {
	ACTION,
	CLUE,
	CARD_COUNT,
}