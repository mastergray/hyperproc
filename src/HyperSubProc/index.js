// Dependencies:
import HyperProc from "../index.js";

// For implementing "subprocess" that can be chained to a "parent" process:
// NOTE: Really this is ensuring errors being thrown by a "subprocess" are being "bubbled up" to it's parent process:
export default class HyperSubProc extends HyperProc {

    // CONSTRUCTOR :: 
    constructor(env = {}) {
        super(env);
        this._onError = (err) => { throw err; };
    }

}