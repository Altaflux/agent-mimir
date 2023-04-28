
export function createBulletedList(arr: string[]) {
    let listString = '';
    for (let i = 0; i < arr.length; i++) {
        listString += '• ' + arr[i] + '\n';
    }
    return listString;
}