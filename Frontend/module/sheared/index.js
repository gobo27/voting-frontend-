const content = document.querySelector("#content");
const submit = document.querySelector('#add');
const update = document.querySelector('#update');

//POST API
submit.addEventListener('click', () => {
    let event_name = document.querySelector("#event").value;
    let date_time = document.querySelector("#dateTime").value;
    let address = document.querySelector("#address").value;
    let reservation_name = document.querySelector("#reservationName").value;
    let formData={event_name, date_time, address, reservation_name};

    if(event_name && date_time && address && reservation_name) {

        fetch('https://bscs3-semis-ems.onrender.com/api/add', {
        method: 'POST',
        body: JSON.stringify(formData), 
        headers: {
            "Content-Type": "application/json",
        },
        }).catch((error) => {
            console.log(error);
        })
        alert("Event Added Successfully");
        location.reload();
    }

    
});

window.addEventListener('load', () => {
    getEventList();
})

function getEventList(){
    let html = ""
    //FETCH API IN RENDER
    fetch('https://bscs3-semis-ems.onrender.com/api/eventList', {mode:'cors'})

    // FETCH API IN LOCALHOST
    // fetch('http://localhost:7700/api/eventList', {mode:'cors'})

    .then(response=>{
        console.log(response);
        return response.json();
    })

    .then(data=>{
        console.log(data);
        data.forEach(element=>{

            const eventDate = new Date(element.date_time.replace(' ', 'T'));

            const formattedDate = eventDate.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC'
            });


            const formattedTime = eventDate.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true,
            timeZone: 'UTC'
            });

            html+=`
            <tr>
                <td>${element.event_name}</td>
                <td>
                    <div class="flex justify-between">
                        <div>${formattedDate}</div>
                        <div>${formattedTime}</div>
                    </div>
                </td>
                <td>${element.address}</td>
                <td>${element.reservation_name}</td>
                <td class="flex justify-center items-center">
                    <a href="javascript:void(0)" id="update" onClick="updateEvent(${element.id})" class="mt-4 w-auto"><img src="./edit.png" class="w-5 h-5 mx-4 hover:h-6">
                    </button>
                
                    <a href="javascript:void(0)" id="add" onClick="deleteEvent(${element.id})" class="mt-4"> <img src="./bin.png" class="w-5 h-5 hover:h-6" ></a>
                    
                    
                </td>
            </tr>`    
        })
        content.innerHTML=html;
    })
    .catch(error=>{
        console.log(error);
    })
}


//DELETE
function deleteEvent(id){

    let text;

    if (confirm("Press a button!") == true) {
        
    
        fetch("https://bscs3-semis-ems.onrender.com/api/delete",{
            method:'DELETE',
            body: JSON.stringify({id}),
            headers:{
                "Content-Type":"application/json",
            },
        })
        .then(response=> {
            if (response.ok) {
                alert("User Deleted Successfully");
                location.reload();
            } else {
                alert ("Error Deleting User");
            }
        }).catch(error => console.log(error));
    }
}

// search
    function updateEvent(id){
    fetch(`https://bscs3-semis-ems.onrender.com/api/eventId/${id}`)
    .then(response => response.json())
    .then(data => {

        submit.classList.add("hidden")
        update.classList.remove("hidden")

        const eventDate = new Date(data[0].date_time);
        eventDate.setHours(eventDate.getHours() - 8);

        const yyyy = eventDate.getFullYear();
        const MM = String(eventDate.getMonth() + 1).padStart(2, '0');
        const dd = String(eventDate.getDate()).padStart(2, '0');
        const hh = String(eventDate.getHours()).padStart(2, '0');
        const mm = String(eventDate.getMinutes()).padStart(2, '0');

        const formattedForInput = `${yyyy}-${MM}-${dd}T${hh}:${mm}`;

        document.querySelector("#event").value = data[0].event_name;
        document.querySelector("#dateTime").value = formattedForInput;
        document.querySelector("#address").value = data[0].address;
        document.querySelector("#reservationName").value = data[0].reservation_name;
        document.querySelector("#ID").value = data[0].id;

    }).catch(error => {
        console.log(error)
    })
}

// put
update.addEventListener('click', () => {
    let event_name = document.querySelector("#event").value;
    let date_time = document.querySelector("#dateTime").value;
    let address = document.querySelector("#address").value;
    let reservation_name = document.querySelector("#reservationName").value;

    let id = document.querySelector("#ID").value

    let formdata = {event_name,date_time,address,reservation_name,id};
    fetch (`https://bscs3-semis-ems.onrender.com/api/update`, {
        method: 'PUT',
        body: JSON.stringify(formdata),
        headers : {
            "Content-Type" : "application/json",
        },
    })
    .then(response => {
        if (response.ok) {
            alert("Event Updated Successfully");
            location.reload(); 
        } else {
            alert("Update Error.");
        }
    }).catch((error)=>{
        console.log(error);
    })
})