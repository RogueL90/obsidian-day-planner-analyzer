// Convert minutes to hours and minutes in the form "X hour(s) Y minute(s)"
const timeFormat = (val: number) =>{
    val = Math.round(val)
    const hours = Math.floor(val/60)
    const mins = val%60
    let hrString
    let minString
    if(hours ===0){
        hrString = ""
    }else if(hours ===1){
        hrString = "1 hr"
    }else{
        hrString = hours + " hrs"
    }
    if(mins ===0){
        minString = ""
    }else if(mins ===1){
        minString = "1 min"
    }else{
        minString = mins + " mins"
    }
    return hrString + (hrString ===""?"":" ") + minString
}

export default timeFormat;