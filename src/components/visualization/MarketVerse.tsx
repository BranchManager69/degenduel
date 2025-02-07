// Change the loading manager callback to ignore unused parameters
// From:
(url, itemsLoaded, itemsTotal) => {
// To:
(_url: string, itemsLoaded: number, itemsTotal: number) => {

// And since loadTokenTexture is unused, we can either remove it or
// mark it with an underscore if we plan to use it later:
const _loadTokenTexture = async ( 