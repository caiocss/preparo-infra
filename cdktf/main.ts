import {App} from "cdktf";
import {LanchoneteConstruct} from "./lib/lanchonete";

const app = new App();
new LanchoneteConstruct(app, "lanchonete",{cidrBlock: "10.0.0.0/16",prefix: "Lanchonete"});
app.synth();
